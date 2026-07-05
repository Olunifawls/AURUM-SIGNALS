import { Inject, Injectable, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../supabase/supabase.provider';
import {
  AmbiguousSubmitError,
  BROKER_ADAPTER,
  IBrokerAdapter,
  Side,
} from './broker.interface';
import { scrubSecrets } from '../killswitch/scrub';

export interface PlaceForSignalInput {
  signalId: string;
  brokerAccountId: string | null;
  side: Side;
  units: number;
  requestedPrice?: number;
  stopLoss?: number;
  takeProfit?: number;
  mode?: 'demo' | 'live';
  instrumentOanda?: string; // default 'XAU_USD'
  // INC-2 sizing (persisted on the order row)
  equityAtEntry?: number;
  riskCcy?: number;
  riskPctActual?: number;
}

export interface PlaceOutcome {
  placed: boolean;
  orderId?: string;
  status: 'FILLED' | 'SUBMITTED' | 'REJECTED' | 'ERROR' | 'DUPLICATE';
  reason?: string;
  brokerTradeId?: string;
  fillPrice?: number;
  reconciled?: boolean;
}

function isUniqueViolation(err: { code?: string; message?: string } | null): boolean {
  return !!err && (err.code === '23505' || (err.message ?? '').includes('uq_orders_active_signal'));
}

/**
 * Idempotent place flow (roadmap D2/B1):
 *   1. INSERT the orders row PENDING first (client_tag = aurum-{signal_id}).
 *      If uq_orders_active_signal rejects it -> a signal already has an active
 *      order -> DO NOT submit.
 *   2. Submit the market order to the broker (NEVER blind-retried).
 *   3. FILLED/REJECTED -> update the row. Ambiguous submit -> reconcile by the
 *      client tag (getTransactionsSince) to decide FILLED vs ERROR; never re-submit.
 */
@Injectable()
export class OrderPlacementService {
  private readonly logger = new Logger('OrderPlacement');

  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient | null,
    @Inject(BROKER_ADAPTER) private readonly broker: IBrokerAdapter,
  ) {}

  async placeForSignal(input: PlaceForSignalInput): Promise<PlaceOutcome> {
    if (!this.supabase) throw new Error('Supabase client not configured');
    const mode = input.mode ?? 'demo';
    const tag = `aurum-${input.signalId}`;
    const instrument = input.instrumentOanda ?? 'XAU_USD';

    // 1) Pre-insert PENDING (the DB idempotency guard runs here).
    const ins = await this.supabase
      .from('orders')
      .insert({
        signal_id: input.signalId,
        broker_account_id: input.brokerAccountId,
        mode,
        instrument: 'XAU/USD',
        side: input.side,
        units: input.units,
        requested_price: input.requestedPrice ?? null,
        stop_loss: input.stopLoss ?? null,
        take_profit: input.takeProfit ?? null,
        status: 'PENDING',
        client_tag: tag,
        equity_at_entry: input.equityAtEntry ?? null,
        risk_ccy: input.riskCcy ?? null,
        risk_pct_actual: input.riskPctActual ?? null,
      })
      .select('id')
      .single();

    if (ins.error) {
      if (isUniqueViolation(ins.error)) {
        this.logger.warn(`duplicate active order blocked for signal ${input.signalId}`);
        return { placed: false, status: 'DUPLICATE', reason: 'active order already exists for this signal' };
      }
      throw new Error(`order pre-insert failed: ${ins.error.message}`);
    }
    const orderId = (ins.data as { id: string }).id;

    // Capture a baseline transaction id BEFORE submit so reconciliation can find
    // any transaction created by an ambiguous submit.
    let sinceId: string | null = null;
    try {
      sinceId = (await this.broker.getAccount()).lastTransactionId;
    } catch {
      /* non-fatal — reconciliation will fall back to open trades */
    }

    // 2) Submit (never blind-retried).
    let result;
    try {
      result = await this.broker.placeMarketOrder({
        instrument,
        side: input.side,
        units: input.units,
        stopLossPrice: input.stopLoss,
        takeProfitPrice: input.takeProfit,
        clientTag: tag,
      });
    } catch (err) {
      if (err instanceof AmbiguousSubmitError) {
        return this.reconcileAmbiguous(orderId, tag, sinceId, String(err));
      }
      await this.update(orderId, { status: 'ERROR', reason: String(err) });
      return { placed: false, orderId, status: 'ERROR', reason: String(err) };
    }

    // 3) Definitive response.
    if (result.status === 'FILLED') {
      await this.update(orderId, {
        status: 'FILLED',
        broker_order_id: result.brokerOrderId ?? null,
        broker_trade_id: result.brokerTradeId ?? null,
        filled_price: result.fillPrice ?? null,
        filled_at: new Date().toISOString(),
        meta: { raw: scrubSecrets(result.raw) },
      });
      return { placed: true, orderId, status: 'FILLED', brokerTradeId: result.brokerTradeId, fillPrice: result.fillPrice };
    }
    await this.update(orderId, { status: 'REJECTED', reason: result.reason ?? 'rejected', meta: { raw: scrubSecrets(result.raw) } });
    return { placed: false, orderId, status: 'REJECTED', reason: result.reason };
  }

  /** Ambiguous submit: reconcile by tag. NEVER re-submit. */
  private async reconcileAmbiguous(
    orderId: string,
    tag: string,
    sinceId: string | null,
    errMsg: string,
  ): Promise<PlaceOutcome> {
    let matched = false;
    let brokerTradeId: string | undefined;
    try {
      if (sinceId != null) {
        const txns = await this.broker.getTransactionsSince(sinceId);
        matched = txns.some((t) => t.clientTag === tag);
      }
      if (!matched) {
        const trades = await this.broker.getOpenTrades();
        const trade = trades.find((t) => t.clientTag === tag);
        if (trade) {
          matched = true;
          brokerTradeId = trade.id;
        }
      }
    } catch (e) {
      this.logger.error(`reconciliation lookup failed: ${String(e)}`);
    }

    if (matched) {
      await this.update(orderId, {
        status: 'FILLED',
        broker_trade_id: brokerTradeId ?? null,
        filled_at: new Date().toISOString(),
        reason: `reconciled after ambiguous submit (${errMsg})`,
      });
      return { placed: true, orderId, status: 'FILLED', brokerTradeId, reconciled: true };
    }
    await this.update(orderId, {
      status: 'ERROR',
      reason: `ambiguous submit, no matching transaction on reconcile (${errMsg})`,
    });
    return { placed: false, orderId, status: 'ERROR', reconciled: true, reason: 'ambiguous, not found' };
  }

  private async update(orderId: string, fields: Record<string, unknown>): Promise<void> {
    if (!this.supabase) return;
    const { error } = await this.supabase
      .from('orders')
      .update({ ...fields, updated_at: new Date().toISOString() })
      .eq('id', orderId);
    if (error) this.logger.error(`order update failed: ${error.message}`);
  }
}
