import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../supabase/supabase.provider';
import { BROKER_ADAPTER, IBrokerAdapter } from '../broker/broker.interface';
import { AlertsService } from '../alerts/alerts.service';
import { TradingStateService } from '../risk/trading-state.service';
import { level2Config } from '../level2/level2.config';
import { SYMBOL } from '../ingestion/ingestion.constants';
import { isGoldMarketOpen } from '../ingestion/market-hours';
import {
  HaltSpec,
  evalBrokerErrors,
  evalConsecutiveSl,
  evalDailyLoss,
  evalDrawdown,
  evalFeedStale,
  evalWeeklyLoss,
} from './breakers';
import { scrubString } from './scrub';

/**
 * Circuit breakers (§6 + D6). Each trigger sets a PERSISTENT halt/cooldown (that
 * INC-2's checks read), logs a TRADING_HALTED risk_events row, and sends a
 * Telegram alert. DEMO ONLY. Never touches live mode.
 */
@Injectable()
export class CircuitBreakerService {
  private readonly logger = new Logger('CircuitBreaker');
  private brokerErrorTimes: number[] = [];

  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient | null,
    @Inject(BROKER_ADAPTER) private readonly broker: IBrokerAdapter,
    private readonly state: TradingStateService,
    private readonly alerts: AlertsService,
  ) {}

  /** Set the halt, log a TRADING_HALTED risk_events row, send a Telegram alert. */
  async applySpec(spec: HaltSpec): Promise<void> {
    await this.state.setHalt(spec.type, {
      scope: spec.scope,
      reason: spec.reason,
      requiresManual: spec.requiresManual,
      clearsAt: spec.clearsAt ?? null,
    });
    if (this.supabase) {
      await this.supabase.from('risk_events').insert({
        mode: 'demo',
        event_type: 'TRADING_HALTED',
        severity: spec.requiresManual ? 'CRITICAL' : 'WARN',
        message: scrubString(`${spec.type}: ${spec.reason}`),
        meta: { haltType: spec.type, scope: spec.scope, requiresManual: spec.requiresManual, clearsAt: spec.clearsAt ?? null },
      });
    }
    void this.alerts.sendAdminError(`halt-${spec.type}`, scrubString(`🛑 HALT ${spec.type}: ${spec.reason}`)).catch(() => undefined);
    this.logger.warn(scrubString(`halt set: ${spec.type} (${spec.reason})`));
  }

  /** Record a broker API error; halts after ×5 in 10 min (§6). */
  async recordBrokerError(now: Date = new Date()): Promise<void> {
    this.brokerErrorTimes.push(now.getTime());
    this.brokerErrorTimes = this.brokerErrorTimes.filter((t) => t >= now.getTime() - 10 * 60_000);
    const spec = evalBrokerErrors(this.brokerErrorTimes, now);
    if (spec) await this.applySpec(spec);
  }

  /** Reconcile mismatch involving an unexpected fill -> halt (§6). */
  async escalateUnexpectedFill(tradeId: string): Promise<void> {
    await this.applySpec({ type: 'RECONCILE_HALT', scope: 'NEW_ORDERS', reason: `reconcile: unexpected fill ${tradeId}`, requiresManual: true });
  }

  @Cron('*/3 * * * *')
  async runBreakers(now: Date = new Date()): Promise<void> {
    if (!this.supabase || !process.env.OANDA_ACCOUNT_ID_DEMO) return;
    try {
      const cfg = level2Config();
      const account = await this.broker.getAccount();
      const { daily, weekly, hwm } = await this.equityBaselines(now);

      const dailyPct = daily ? ((daily - account.equity) / daily) * 100 : 0;
      const weeklyPct = weekly ? ((weekly - account.equity) / weekly) * 100 : 0;

      const specs: (HaltSpec | null)[] = [
        evalDrawdown({ equity: account.equity, highWaterMark: hwm ?? 0, maxDrawdownPct: cfg.maxTotalDrawdownPct }),
        evalDailyLoss({ dailyLossPct: dailyPct, maxDailyPct: cfg.maxDailyLossPct, now }),
        evalWeeklyLoss({ weeklyLossPct: weeklyPct, maxWeeklyPct: cfg.maxWeeklyLossPct, now }),
        evalConsecutiveSl(await this.recentCloseReasons()),
        evalFeedStale(await this.lastFeedTs(), now, isGoldMarketOpen(now)),
      ];
      for (const spec of specs) if (spec) await this.applySpec(spec);

      // Feed recovered -> auto-clear the stale halt.
      if (!evalFeedStale(await this.lastFeedTs(), now, isGoldMarketOpen(now))) {
        await this.state.clearHalt('FEED_STALE');
      }
    } catch (err) {
      this.logger.error(scrubString(`runBreakers failed: ${String(err)}`));
    }
  }

  private async equityBaselines(now: Date): Promise<{ daily: number | null; weekly: number | null; hwm: number | null }> {
    const startOfDayUk = new Date(now);
    startOfDayUk.setUTCHours(0, 0, 0, 0);
    const [daily, hwm] = await Promise.all([this.snapshotBefore(startOfDayUk.toISOString()), this.maxEquity()]);
    return { daily, weekly: daily, hwm };
  }

  private async snapshotBefore(tsIso: string): Promise<number | null> {
    if (!this.supabase) return null;
    const { data } = await this.supabase.from('equity_snapshots').select('equity').lte('ts', tsIso).order('ts', { ascending: false }).limit(1);
    return data?.length ? Number(data[0].equity) : null;
  }
  private async maxEquity(): Promise<number | null> {
    if (!this.supabase) return null;
    const { data } = await this.supabase.from('equity_snapshots').select('high_water_mark').order('high_water_mark', { ascending: false }).limit(1);
    return data?.length && data[0].high_water_mark != null ? Number(data[0].high_water_mark) : null;
  }
  private async recentCloseReasons(): Promise<string[]> {
    if (!this.supabase) return [];
    const { data } = await this.supabase.from('positions').select('close_reason').eq('status', 'CLOSED').order('closed_at', { ascending: false }).limit(10);
    return (data ?? []).map((r) => r.close_reason as string);
  }
  private async lastFeedTs(): Promise<string | null> {
    if (!this.supabase) return null;
    const { data } = await this.supabase.from('candles').select('ts').eq('symbol', SYMBOL).eq('timeframe', '15min').order('ts', { ascending: false }).limit(1);
    return data?.length ? (data[0].ts as string) : null;
  }
}
