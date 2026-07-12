import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../supabase/supabase.provider';
import { BROKER_ADAPTER, IBrokerAdapter } from '../broker/broker.interface';
import { AlertsService } from '../alerts/alerts.service';
import { SYMBOL } from '../ingestion/ingestion.constants';
import { CircuitBreakerService } from '../killswitch/circuit-breaker.service';
import { ExecutionReadinessService } from './readiness.service';
import { inferCloseReason, realizedR } from './exec-util';

const OANDA_INSTR = 'XAU_USD';

export interface ReconcileResult {
  ok: boolean;
  brokerOpen: number;
  dbOpen: number;
  closedByBroker: number;
  unknownRecorded: number;
  sizeCorrections: number;
  mismatches: number;
}

/**
 * Reconciliation (Phase C). Broker is the SOURCE OF TRUTH: the DB is updated to
 * match the broker. This module NEVER places or closes a trade at the broker to
 * "fix" a mismatch (roadmap C4) — it only reads (getOpenTrades/getTrade/
 * getAccount/getTransactionsSince) and writes the DB. Also snapshots equity.
 */
@Injectable()
export class ReconciliationService implements OnModuleInit {
  private readonly logger = new Logger('Reconcile');

  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient | null,
    @Inject(BROKER_ADAPTER) private readonly broker: IBrokerAdapter,
    private readonly readiness: ExecutionReadinessService,
    private readonly alerts: AlertsService,
    private readonly breaker: CircuitBreakerService,
  ) {}

  /** Startup reconcile (D7/B6): full reconcile BEFORE the order path is enabled. */
  async onModuleInit(): Promise<void> {
    if (!this.supabase || !process.env.OANDA_ACCOUNT_ID_DEMO) {
      this.logger.log('demo broker not configured — reconcile disabled, execution stays gated');
      return;
    }
    try {
      await this.reconcile();
      await this.snapshotEquity('HOURLY');
      this.readiness.markReady();
      this.logger.log('startup reconcile complete — execution enabled');
    } catch (err) {
      this.logger.error(`startup reconcile failed (execution stays gated): ${String(err)}`);
    }
  }

  @Cron('*/5 * * * *')
  async reconcileCron(): Promise<void> {
    if (!this.supabase || !process.env.OANDA_ACCOUNT_ID_DEMO) return;
    try {
      await this.reconcile();
    } catch (err) {
      this.logger.error(`reconcile failed: ${String(err)}`);
    }
  }

  @Cron('0 * * * *')
  async snapshotCron(): Promise<void> {
    if (!this.supabase || !process.env.OANDA_ACCOUNT_ID_DEMO) return;
    const uk = ukHourWeekday(new Date());
    const type = uk.hour === 0 ? (uk.weekday === 1 ? 'WEEKLY_REF' : 'DAILY_REF') : 'HOURLY';
    try {
      await this.snapshotEquity(type);
    } catch (err) {
      this.logger.error(`equity snapshot failed: ${String(err)}`);
    }
  }

  /** Reconcile the DB to the broker. Reads only; NEVER places/closes at broker. */
  async reconcile(): Promise<ReconcileResult> {
    if (!this.supabase) throw new Error('Supabase client not configured');
    const now = new Date().toISOString();
    const [account, openTrades] = await Promise.all([this.broker.getAccount(), this.broker.getOpenTrades()]);
    const brokerOpenIds = new Set(openTrades.map((t) => t.id));

    const { data: dbOpen } = await this.supabase.from('positions').select('*').eq('status', 'OPEN');
    const positions = dbOpen ?? [];

    let closedByBroker = 0;
    let sizeCorrections = 0;
    let mismatches = 0;

    for (const pos of positions) {
      const tradeId = pos.broker_trade_id as string | null;
      if (!tradeId) continue;
      if (!brokerOpenIds.has(tradeId)) {
        // Broker no longer shows it open -> it was closed at the broker.
        const trade = await this.broker.getTrade(tradeId);
        if (trade.state === 'CLOSED') {
          const closePrice = trade.closePrice ?? Number(pos.entry_price);
          const initialSL = Number(pos.initial_stop_loss ?? pos.stop_loss);
          const rr = realizedR(Number(pos.entry_price), initialSL, closePrice, pos.side);
          const reason = inferCloseReason(closePrice, Number(pos.stop_loss), Number(pos.take_profit));
          await this.supabase
            .from('positions')
            .update({
              status: 'CLOSED',
              closed_at: now,
              close_price: closePrice,
              realized_pl: trade.realizedPl,
              realized_pl_ccy: account.currency,
              realized_r: rr,
              close_reason: reason,
              updated_at: now,
            })
            .eq('id', pos.id);
          closedByBroker++;
          mismatches++;
          await this.logMismatch('position_closed_at_broker', `position ${pos.id} closed at broker (${reason}, pl=${trade.realizedPl})`, { positionId: pos.id, tradeId });
        }
      } else {
        // Still open — correct any size mismatch (broker = truth).
        const bt = openTrades.find((t) => t.id === tradeId);
        if (bt && Math.abs(bt.units - Number(pos.units)) > 1e-6) {
          await this.supabase.from('positions').update({ units: bt.units, updated_at: now }).eq('id', pos.id);
          sizeCorrections++;
          mismatches++;
          await this.logMismatch('size_mismatch_corrected', `position ${pos.id} size ${pos.units} -> ${bt.units}`, { positionId: pos.id, tradeId });
        }
      }
    }

    // Broker trades we don't know about (e.g. externally opened) -> record them.
    const knownTradeIds = new Set(positions.map((p) => p.broker_trade_id).filter(Boolean));
    let unknownRecorded = 0;
    for (const bt of openTrades) {
      if (!knownTradeIds.has(bt.id)) {
        await this.supabase.from('positions').insert({
          mode: 'demo',
          instrument: bt.instrument === OANDA_INSTR ? SYMBOL : bt.instrument,
          side: bt.side,
          units: bt.units,
          entry_price: bt.price,
          status: 'OPEN',
          opened_at: now,
          broker_trade_id: bt.id,
          meta: { reconciledUnknown: true, clientTag: bt.clientTag ?? null },
        });
        unknownRecorded++;
        mismatches++;
        await this.logMismatch('unknown_broker_trade_recorded', `recorded unknown broker trade ${bt.id}`, { tradeId: bt.id });
        // §6: a reconcile mismatch involving an unexpected fill escalates to a halt.
        await this.breaker.escalateUnexpectedFill(bt.id);
      }
    }

    // Advance the sync cursor.
    await this.supabase
      .from('broker_accounts')
      .update({ last_transaction_id: account.lastTransactionId, last_reconciled_at: now })
      .eq('broker', 'OANDA')
      .eq('mode', 'demo');

    return { ok: true, brokerOpen: openTrades.length, dbOpen: positions.length, closedByBroker, unknownRecorded, sizeCorrections, mismatches };
  }

  async snapshotEquity(type: 'HOURLY' | 'DAILY_REF' | 'WEEKLY_REF'): Promise<void> {
    if (!this.supabase) return;
    const [account, openTrades] = await Promise.all([this.broker.getAccount(), this.broker.getOpenTrades()]);
    const { data: ba } = await this.supabase
      .from('broker_accounts')
      .select('id')
      .eq('broker', 'OANDA')
      .eq('mode', 'demo')
      .limit(1);
    const prevHwm = await this.currentHwm();
    const hwm = Math.max(prevHwm ?? 0, account.equity);
    await this.supabase.from('equity_snapshots').insert({
      broker_account_id: ba?.[0]?.id ?? null,
      mode: 'demo',
      balance: account.balance,
      equity: account.equity,
      unrealized_pl: account.unrealizedPl,
      open_positions: openTrades.length,
      high_water_mark: hwm,
      snapshot_type: type,
      ts: new Date().toISOString(),
    });
  }

  private async currentHwm(): Promise<number | null> {
    const { data } = await this.supabase!
      .from('equity_snapshots')
      .select('high_water_mark')
      .order('high_water_mark', { ascending: false })
      .limit(1);
    return data && data.length && data[0].high_water_mark != null ? Number(data[0].high_water_mark) : null;
  }

  private async logMismatch(kind: string, message: string, meta: Record<string, unknown>): Promise<void> {
    if (this.supabase) {
      await this.supabase.from('risk_events').insert({ mode: 'demo', event_type: 'RECONCILE_MISMATCH', severity: 'WARN', message: `${kind}: ${message}`, meta });
    }
    // Reuse L1 AlertsService for the admin alert (throttled per source).
    void this.alerts.sendAdminError('reconcile', `RECONCILE_MISMATCH ${kind}: ${message}`).catch(() => undefined);
  }
}

function ukHourWeekday(d: Date): { hour: number; weekday: number } {
  const f = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', weekday: 'short', hour12: false });
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { hour: Number(p.hour) % 24, weekday: map[p.weekday as string] ?? -1 };
}
