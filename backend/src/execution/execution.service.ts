import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../supabase/supabase.provider';
import { BROKER_ADAPTER, IBrokerAdapter, Side } from '../broker/broker.interface';
import { OrderPlacementService } from '../broker/order-placement.service';
import { RiskManagerService } from '../risk/risk-manager.service';
import { level2Config } from '../level2/level2.config';
import { SYMBOL } from '../ingestion/ingestion.constants';
import { ExecutionReadinessService } from './readiness.service';
import { achievedRr, actualRiskPctAtFill, isTimeStopped, realizedR, slippagePoints } from './exec-util';

export interface SignalForExec {
  id: string;
  timeframe: string;
  direction: Side;
  entry_price: number | string;
  stop_loss: number | string;
  take_profit: number | string;
  track: 'core' | 'experimental';
  status?: string;
}

export interface ExecutionOutcome {
  executed: boolean;
  reason?: string;
  orderStatus?: string;
  orderId?: string;
  positionId?: string;
  brokerTradeId?: string;
}

const CORE_TIMEFRAMES = new Set(['1h', '4h']);

/**
 * Execution (Phase C). Consumes NEW CORE-track signals only (1h/4h; NEVER the
 * experimental 15min track), runs INC-2 RiskManager, and places via INC-1's
 * idempotent OrderPlacementService with SL/TP attached atomically. On fill,
 * records a positions row (+ slippage handling). Gated on AUTO_TRADE_ENABLED and
 * the startup reconcile. DEMO ONLY.
 */
@Injectable()
export class ExecutionService {
  private readonly logger = new Logger('Execution');

  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient | null,
    @Inject(BROKER_ADAPTER) private readonly broker: IBrokerAdapter,
    private readonly risk: RiskManagerService,
    private readonly placement: OrderPlacementService,
    private readonly readiness: ExecutionReadinessService,
  ) {}

  async executeSignal(sig: SignalForExec): Promise<ExecutionOutcome> {
    // NEVER auto-execute the experimental 15min track.
    if (sig.track !== 'core') return { executed: false, reason: 'experimental_track_excluded' };
    if (!CORE_TIMEFRAMES.has(sig.timeframe)) return { executed: false, reason: 'non_core_timeframe' };
    if (!level2Config().autoTradeEnabled) return { executed: false, reason: 'auto_trade_disabled' };
    // Startup-reconcile gate (D7/B6): no order until the first reconcile completes.
    if (!this.readiness.isReady()) return { executed: false, reason: 'reconcile_pending' };

    const intent = {
      signalId: sig.id,
      side: sig.direction,
      timeframe: sig.timeframe,
      entryPrice: Number(sig.entry_price),
      stopLoss: Number(sig.stop_loss),
      takeProfit: Number(sig.take_profit),
    };
    const decision = await this.risk.assess(intent);
    if (!decision.approved || !decision.sizing) {
      return { executed: false, reason: decision.reason };
    }
    const s = decision.sizing;

    const brokerAccountId = await this.brokerAccountId();
    const outcome = await this.placement.placeForSignal({
      signalId: sig.id,
      brokerAccountId,
      side: sig.direction,
      units: s.units,
      requestedPrice: s.requestedEntry,
      stopLoss: s.stopLoss, // stopLossOnFill + takeProfitOnFill sent in ONE atomic request
      takeProfit: s.takeProfit,
      equityAtEntry: s.equityAtEntry,
      riskCcy: s.riskCcy,
      riskPctActual: s.riskPctActual,
    });

    if (outcome.status !== 'FILLED') {
      return { executed: false, reason: outcome.reason, orderStatus: outcome.status, orderId: outcome.orderId };
    }

    const positionId = await this.onFill(sig, s, outcome, brokerAccountId);
    this.logger.log(`executed ${sig.direction} ${sig.timeframe} -> FILLED trade=${outcome.brokerTradeId} units=${s.units}`);
    return { executed: true, orderId: outcome.orderId, positionId, brokerTradeId: outcome.brokerTradeId };
  }

  /** On fill: slippage + achieved RR + risk_pct_actual, then create the position. */
  async onFill(
    sig: SignalForExec,
    sizing: { requestedEntry: number; stopLoss: number; takeProfit: number; units: number; riskPctActual: number },
    outcome: { orderId?: string; brokerTradeId?: string; fillPrice?: number },
    brokerAccountId: string | null,
  ): Promise<string | undefined> {
    if (!this.supabase) return undefined;
    const now = new Date().toISOString();
    const fill = outcome.fillPrice ?? sizing.requestedEntry;
    const slip = slippagePoints(fill, sizing.requestedEntry);
    const rr = achievedRr(fill, sizing.stopLoss, sizing.takeProfit);
    const riskPctActual = actualRiskPctAtFill(sizing.riskPctActual, sizing.requestedEntry, sizing.stopLoss, fill);
    const maxSlippage = level2Config().maxSlippagePoints;

    if (slip > maxSlippage) {
      // Order STANDS (SL/TP already attached). Log it and keep the recomputed RR.
      await this.logRisk('SLIPPAGE_EXCEEDED', `slippage ${slip.toFixed(4)} > ${maxSlippage} on ${outcome.brokerTradeId}; order stands, achieved RR ${rr}`, { orderId: outcome.orderId, slip, achievedRr: rr });
    }
    if (riskPctActual > 3.0) {
      await this.logRisk('RISK_PCT_EXCEEDED', `risk_pct_actual ${riskPctActual}% > 3.0% after fill; SL caps the loss`, { orderId: outcome.orderId, riskPctActual });
    }

    const { data, error } = await this.supabase
      .from('positions')
      .insert({
        broker_account_id: brokerAccountId,
        order_id: outcome.orderId ?? null,
        signal_id: sig.id,
        mode: 'demo',
        instrument: SYMBOL,
        timeframe: sig.timeframe,
        side: sig.direction,
        units: sizing.units,
        entry_price: fill,
        stop_loss: sizing.stopLoss,
        initial_stop_loss: sizing.stopLoss,
        take_profit: sizing.takeProfit,
        status: 'OPEN',
        opened_at: now,
        slippage_points: slip,
        risk_pct_actual: riskPctActual,
        achieved_rr: rr,
        broker_trade_id: outcome.brokerTradeId ?? null,
      })
      .select('id')
      .single();
    if (error) {
      this.logger.error(`position insert failed: ${error.message}`);
      return undefined;
    }
    return (data as { id: string }).id;
  }

  /** TIME STOP: positions open > 5 trading days without SL/TP -> close at market. */
  @Cron('0 */2 * * *')
  async checkTimeStops(now: Date = new Date()): Promise<number> {
    if (!this.supabase || !process.env.OANDA_ACCOUNT_ID_DEMO) return 0;
    const { data } = await this.supabase.from('positions').select('*').eq('status', 'OPEN');
    let closed = 0;
    for (const pos of data ?? []) {
      if (!pos.opened_at || !isTimeStopped(pos.opened_at, now)) continue;
      const tradeId = pos.broker_trade_id as string | null;
      let closePrice = Number(pos.entry_price);
      if (tradeId) {
        const res = await this.broker.closeTrade(tradeId); // execution MAY close (time stop)
        void res;
        try {
          const t = await this.broker.getTrade(tradeId);
          closePrice = t.closePrice ?? closePrice;
        } catch {
          /* best-effort */
        }
      }
      const initialSL = Number(pos.initial_stop_loss ?? pos.stop_loss);
      const rr = realizedR(Number(pos.entry_price), initialSL, closePrice, pos.side);
      await this.supabase
        .from('positions')
        .update({ status: 'CLOSED', close_reason: 'TIME_STOP', closed_at: now.toISOString(), close_price: closePrice, realized_r: rr, updated_at: now.toISOString() })
        .eq('id', pos.id);
      closed++;
      this.logger.log(`time-stop closed position ${pos.id}`);
    }
    return closed;
  }

  /** Poll for NEW core signals without an order and execute them. */
  @Cron('*/2 * * * *')
  async pollNewSignals(): Promise<void> {
    if (!this.supabase || !this.readiness.isReady() || !level2Config().autoTradeEnabled) return;
    const { data: sigs } = await this.supabase
      .from('signals')
      .select('id,timeframe,direction,entry_price,stop_loss,take_profit,track,status')
      .eq('symbol', SYMBOL)
      .eq('status', 'OPEN')
      .eq('track', 'core')
      .in('timeframe', ['1h', '4h'])
      .order('created_at', { ascending: false })
      .limit(20);
    if (!sigs?.length) return;
    const { data: ords } = await this.supabase.from('orders').select('signal_id');
    const withOrder = new Set((ords ?? []).map((o) => o.signal_id));
    for (const sig of sigs) {
      if (!withOrder.has(sig.id)) await this.executeSignal(sig as SignalForExec);
    }
  }

  private async brokerAccountId(): Promise<string | null> {
    if (!this.supabase) return null;
    const { data } = await this.supabase
      .from('broker_accounts')
      .select('id')
      .eq('broker', 'OANDA')
      .eq('mode', 'demo')
      .limit(1);
    return data?.[0]?.id ?? null;
  }

  private async logRisk(eventType: string, message: string, meta: Record<string, unknown>): Promise<void> {
    if (!this.supabase) return;
    await this.supabase.from('risk_events').insert({ mode: 'demo', event_type: eventType, severity: 'WARN', message, meta });
  }
}
