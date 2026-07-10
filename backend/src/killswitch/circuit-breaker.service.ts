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
  evalSessionGap,
  evalVolatility,
  evalWeeklyLoss,
} from './breakers';
import { scrubString } from './scrub';

/**
 * Circuit breakers (§6 + D6). Each trigger sets a PERSISTENT halt/cooldown (that
 * INC-2's checks read), logs a TRADING_HALTED risk_events row, and sends a
 * Telegram alert. DEMO ONLY. Never touches live mode.
 *
 * Wiring completed (INC-4 follow-up):
 *  VOLATILITY_COOLDOWN — 15min candle range > 3×ATR14, OR 15min price move > 2×hourly ATR,
 *    OR spread > 2.5×24h average → 2h timed halt (auto-clears).
 *    Inputs: indicator_snapshots (atr_14 for 15min + 1h), candles (last completed 15min),
 *    OANDA live pricing (spread; rolling 24h in-memory history).
 *  SESSION_GAP — daily open gap > 1.5×daily ATR → 4h timed halt (auto-clears).
 *    Inputs: indicator_snapshots (atr_14 for 1day), candles (last 2 completed 1day).
 *    Only evaluated when the most recent daily candle is < 24h old (one fire per session).
 */
@Injectable()
export class CircuitBreakerService {
  private readonly logger = new Logger('CircuitBreaker');
  private brokerErrorTimes: number[] = [];

  /** Rolling 24h spread observations (~480 samples at 3min cadence). Reseeds on restart. */
  private readonly spreadHistory: number[] = [];
  private static readonly SPREAD_HISTORY_MAX = 480;

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

  /**
   * Admin test-fire: directly evaluate a breaker with synthetic inputs and apply
   * the spec if it fires. Returns the spec that was applied (or null if no trigger).
   * DEMO-ONLY; called only from the admin test endpoint (AdminTokenGuard + confirm).
   */
  async testFireBreaker(
    type: 'VOLATILITY_COOLDOWN' | 'SESSION_GAP',
    inputs: Record<string, number>,
    now: Date = new Date(),
  ): Promise<HaltSpec | null> {
    let spec: HaltSpec | null = null;
    if (type === 'VOLATILITY_COOLDOWN') {
      spec = evalVolatility({
        lastRange: Number(inputs.lastRange ?? 0),
        atr14: Number(inputs.atr14 ?? 0),
        priceMove15m: Number(inputs.priceMove15m ?? 0),
        hourlyAtr: Number(inputs.hourlyAtr ?? 0),
        spread: Number(inputs.spread ?? 0),
        spread24hAvg: Number(inputs.spread24hAvg ?? 0),
        now,
      });
    } else {
      spec = evalSessionGap({
        openGap: Number(inputs.openGap ?? 0),
        dailyAtr: Number(inputs.dailyAtr ?? 0),
        now,
      });
    }
    if (spec) await this.applySpec(spec);
    return spec;
  }

  @Cron('*/3 * * * *')
  async runBreakers(now: Date = new Date()): Promise<void> {
    if (!this.supabase || !process.env.OANDA_ACCOUNT_ID_DEMO) return;
    try {
      const cfg = level2Config();

      // Fetch account equity + live pricing in parallel (pricing needed for spread checks).
      const [account, pricing] = await Promise.all([
        this.broker.getAccount(),
        this.broker.getPricing(SYMBOL),
      ]);

      const { daily, weekly, hwm } = await this.equityBaselines(now);
      const dailyPct = daily ? ((daily - account.equity) / daily) * 100 : 0;
      const weeklyPct = weekly ? ((weekly - account.equity) / weekly) * 100 : 0;

      // Accumulate rolling 24h spread history for the spread spike check.
      this.spreadHistory.push(pricing.spread);
      if (this.spreadHistory.length > CircuitBreakerService.SPREAD_HISTORY_MAX) this.spreadHistory.shift();
      const spread24hAvg = this.spreadHistory.reduce((a, b) => a + b, 0) / this.spreadHistory.length;

      // Read active halts once — used to skip re-triggering timed breakers.
      const activeHalts = await this.state.getActiveHalts(now);
      const alreadyCooling = activeHalts.some((h) => h.halt_type === 'VOLATILITY_COOLDOWN');
      const alreadyGapped = activeHalts.some((h) => h.halt_type === 'SESSION_GAP');

      // === Standard breakers (already wired in INC-4) ===
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

      // === VOLATILITY COOLDOWN — newly wired (INC-4 follow-up) ===
      // Guard: skip if already in cooldown (don't extend the 2h timer on subsequent cycles).
      if (!alreadyCooling) {
        const [c15, atr15, atr1h] = await Promise.all([
          this.latestCandle('15min'),
          this.latestIndicatorAtr('15min'),
          this.latestIndicatorAtr('1h'),
        ]);
        if (c15 && atr15 !== null && atr1h !== null) {
          // priceMove15m: move since the last completed 15min bar's close (= current bar's move so far).
          const mid = (pricing.bid + pricing.ask) / 2;
          const spec = evalVolatility({
            lastRange: c15.high - c15.low,
            atr14: atr15,
            priceMove15m: Math.abs(mid - c15.close),
            hourlyAtr: atr1h,
            spread: pricing.spread,
            spread24hAvg,
            now,
          });
          if (spec) await this.applySpec(spec);
        }
      }

      // === SESSION GAP — newly wired (INC-4 follow-up) ===
      // Guard: skip if already in session-gap halt (don't extend the 4h timer).
      // Staleness guard: only fire for the most recent daily candle (< 24h old) so
      // the same historical gap can't re-trigger after the 4h window expires.
      if (!alreadyGapped) {
        const [dailyCandles, atrDaily] = await Promise.all([
          this.latestTwoCandles('1day'),
          this.latestIndicatorAtr('1day'),
        ]);
        if (dailyCandles.length === 2 && atrDaily !== null) {
          const ageMsOfLastDaily = now.getTime() - new Date(dailyCandles[0].ts).getTime();
          if (ageMsOfLastDaily < 24 * 3600_000) {
            const openGap = Math.abs(dailyCandles[0].open - dailyCandles[1].close);
            const spec = evalSessionGap({ openGap, dailyAtr: atrDaily, now });
            if (spec) await this.applySpec(spec);
          }
        }
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
    if (!data?.length) return null;
    // Return bar CLOSE time (open ts + 15 min). The 20-min threshold then means
    // "no 15min bar has closed in >20 min" — genuinely abnormal. Using the bar's
    // open ts caused structural false fires (~21 min after every bar's open time).
    return new Date(new Date(data[0].ts as string).getTime() + 15 * 60_000).toISOString();
  }

  /** Latest ATR-14 for the given timeframe from indicator_snapshots. */
  private async latestIndicatorAtr(timeframe: string): Promise<number | null> {
    if (!this.supabase) return null;
    const { data } = await this.supabase
      .from('indicator_snapshots')
      .select('atr_14')
      .eq('symbol', SYMBOL)
      .eq('timeframe', timeframe)
      .order('ts', { ascending: false })
      .limit(1);
    return data?.length && data[0].atr_14 != null ? Number(data[0].atr_14) : null;
  }

  /** OHLC of the latest completed candle for the given timeframe. */
  private async latestCandle(timeframe: string): Promise<{ open: number; high: number; low: number; close: number } | null> {
    if (!this.supabase) return null;
    const { data } = await this.supabase
      .from('candles')
      .select('open,high,low,close')
      .eq('symbol', SYMBOL)
      .eq('timeframe', timeframe)
      .order('ts', { ascending: false })
      .limit(1);
    return data?.length
      ? { open: Number(data[0].open), high: Number(data[0].high), low: Number(data[0].low), close: Number(data[0].close) }
      : null;
  }

  /** Last two completed candles (most-recent first) with ts for the staleness check. */
  private async latestTwoCandles(timeframe: string): Promise<Array<{ ts: string; open: number; close: number }>> {
    if (!this.supabase) return [];
    const { data } = await this.supabase
      .from('candles')
      .select('ts,open,close')
      .eq('symbol', SYMBOL)
      .eq('timeframe', timeframe)
      .order('ts', { ascending: false })
      .limit(2);
    return (data ?? []).map((r) => ({ ts: r.ts as string, open: Number(r.open), close: Number(r.close) }));
  }
}
