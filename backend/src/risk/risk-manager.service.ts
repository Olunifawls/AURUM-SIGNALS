import { Inject, Injectable, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../supabase/supabase.provider';
import { BROKER_ADAPTER, IBrokerAdapter } from '../broker/broker.interface';
import { level2Config } from '../level2/level2.config';
import { Decision, OrderIntent, RiskContext, RiskEvent } from './risk.types';
import { evaluateOrder } from './evaluate';
import { sessionFlags } from './session';
import { FallbackNewsCalendar, NewsCalendar } from './news';
import { TradingStateService } from './trading-state.service';
import { AlertsService } from '../alerts/alerts.service';

const XAU = 'XAU_USD';

/**
 * Pre-trade risk manager: gathers live inputs, runs the nine checks, logs every
 * rejection/warning to risk_events, and returns the decision + sizing. It does
 * NOT place orders (INC-3) and does NOT set halt state (INC-4).
 */
@Injectable()
export class RiskManagerService {
  private readonly logger = new Logger('RiskManager');
  private readonly news: NewsCalendar = new FallbackNewsCalendar();

  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient | null,
    @Inject(BROKER_ADAPTER) private readonly broker: IBrokerAdapter,
    private readonly state: TradingStateService,
    private readonly alerts: AlertsService,
  ) {}

  /** Assess an order intent. `opts.context` injects a prebuilt context (tests);
   * `opts.now` overrides the clock for deterministic gather tests. */
  async assess(intent: OrderIntent, opts: { context?: RiskContext; now?: Date } = {}): Promise<Decision> {
    const ctx = opts.context ?? (await this.gather(intent, opts.now ?? new Date()));
    const decision = evaluateOrder(intent, ctx);
    await this.logEvents(intent, ctx.mode, decision.events);
    // Wire the deferred INC-2 degraded-news alert to Telegram (throttled).
    if (decision.events.some((e) => e.event_type === 'NEWS_COVERAGE_DEGRADED')) {
      void this.alerts
        .sendAdminError('news-degraded', 'News blackout coverage DEGRADED (fallback calendar; no live API key).')
        .catch(() => undefined);
    }
    this.logger.log(
      `assess ${intent.side} ${intent.timeframe} -> ${decision.approved ? `APPROVED units=${decision.sizing?.units}` : `REJECTED ${decision.reason}`}`,
    );
    return decision;
  }

  /** Gather all live inputs for the checks (broker + DB + env). */
  private async gather(intent: OrderIntent, now: Date): Promise<RiskContext> {
    if (!this.supabase) throw new Error('Supabase client not configured');
    const cfg = level2Config();

    const [account, openTrades, pricing, instrument] = await Promise.all([
      this.broker.getAccount(),
      this.broker.getOpenTrades(), // D9: live broker state (incl. externally opened)
      this.broker.getPricing(XAU),
      this.broker.getInstrument(XAU),
    ]);

    const accountCcy = account.currency === 'USD' ? 'USD' : 'GBP';
    const gbpUsdRate = await this.latestGbpUsd();
    const existingOpenSameDirTf = await this.hasOpenSameDirTf(intent.side, intent.timeframe);
    const resolvedDemoTrades = await this.countResolvedTrades('demo');
    const { daily, weekly, hwm } = await this.equityBaselines(now);
    const [halted, volatilityCooldown] = await Promise.all([this.state.isHalted(now), this.state.isVolatilityCooldown(now)]);

    return {
      now,
      mode: cfg.tradingMode,
      autoTradeEnabled: cfg.autoTradeEnabled,
      halted,
      resolvedDemoTrades,
      session: sessionFlags(now),
      news: (() => {
        const b = this.news.isInBlackout(now);
        return { inBlackout: b.blackout, degraded: this.news.degraded, source: this.news.source };
      })(),
      volatilityCooldown,
      brokerOpenTradeCount: openTrades.length,
      existingOpenSameDirTf,
      maxOpenPositions: cfg.maxOpenPositions,
      equity: account.equity,
      accountCcy,
      gbpUsdRate,
      referenceEquityDaily: daily,
      referenceEquityWeekly: weekly,
      highWaterMark: hwm,
      maxDailyLossPct: cfg.maxDailyLossPct,
      maxWeeklyLossPct: cfg.maxWeeklyLossPct,
      maxTotalDrawdownPct: cfg.maxTotalDrawdownPct,
      spreadPoints: pricing.spread,
      maxSpreadPoints: cfg.maxSpreadPoints,
      marginUsed: account.marginUsed,
      marginRate: instrument.marginRate,
      price: pricing.ask || (pricing.bid + pricing.ask) / 2,
      riskPerTradePct: cfg.riskPerTradePct,
      maxSlippagePoints: cfg.maxSlippagePoints,
      minTradeSize: instrument.minimumTradeSize,
      tier2Unlocked: cfg.tradingMode === 'demo' ? resolvedDemoTrades >= 50 : false,
    };
  }

  private async latestGbpUsd(): Promise<number> {
    const { data } = await this.supabase!
      .from('fx_rates')
      .select('rate')
      .eq('pair', 'GBP/USD')
      .order('ts', { ascending: false })
      .limit(1);
    return data && data.length ? Number(data[0].rate) : 1;
  }

  private async countResolvedTrades(mode: 'demo' | 'live'): Promise<number> {
    const { count } = await this.supabase!
      .from('positions')
      .select('id', { count: 'exact', head: true })
      .eq('mode', mode)
      .eq('status', 'CLOSED');
    return count ?? 0;
  }

  private async hasOpenSameDirTf(side: string, timeframe: string): Promise<boolean> {
    const { data } = await this.supabase!
      .from('positions')
      .select('side, signals(timeframe)')
      .eq('status', 'OPEN')
      .eq('side', side);
    return (data ?? []).some((r: any) => r.signals?.timeframe === timeframe);
  }

  private async equityBaselines(now: Date): Promise<{ daily: number | null; weekly: number | null; hwm: number | null }> {
    // 00:00 UK today and start-of-week (Mon 00:00 UK) baselines from equity_snapshots.
    const startOfDayUk = ukMidnightUtc(now, 0);
    const startOfWeekUk = ukMidnightUtc(now, dayOffsetToMonday(now));
    const [daily, weekly, hwm] = await Promise.all([
      this.latestSnapshotAtOrBefore(startOfDayUk),
      this.latestSnapshotAtOrBefore(startOfWeekUk),
      this.maxEquity(),
    ]);
    return { daily, weekly, hwm };
  }

  private async latestSnapshotAtOrBefore(tsIso: string): Promise<number | null> {
    const { data } = await this.supabase!
      .from('equity_snapshots')
      .select('equity')
      .lte('ts', tsIso)
      .order('ts', { ascending: false })
      .limit(1);
    return data && data.length ? Number(data[0].equity) : null;
  }

  private async maxEquity(): Promise<number | null> {
    const { data } = await this.supabase!
      .from('equity_snapshots')
      .select('equity')
      .order('equity', { ascending: false })
      .limit(1);
    return data && data.length ? Number(data[0].equity) : null;
  }

  private async logEvents(intent: OrderIntent, mode: string, events: RiskEvent[]): Promise<void> {
    if (!this.supabase || events.length === 0) return;
    const rows = events.map((e) => ({
      mode,
      event_type: e.event_type,
      severity: e.severity,
      signal_id: intent.signalId,
      message: e.message,
      meta: e.meta ?? null,
    }));
    const { error } = await this.supabase.from('risk_events').insert(rows);
    if (error) this.logger.error(`risk_events insert failed: ${error.message}`);
  }
}

function ukMidnightUtc(now: Date, dayOffset: number): string {
  // UK date parts, then reconstruct 00:00 UK for (today - dayOffset) as a UTC instant.
  const f = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' });
  const p = Object.fromEntries(f.formatToParts(now).map((x) => [x.type, x.value]));
  const base = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day)) - dayOffset * 86400_000;
  return new Date(base).toISOString();
}

function dayOffsetToMonday(now: Date): number {
  const f = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', weekday: 'short' });
  const wd = f.format(now);
  const map: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
  return map[wd] ?? 0;
}
