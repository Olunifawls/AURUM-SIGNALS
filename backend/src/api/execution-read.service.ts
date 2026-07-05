import { Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../supabase/supabase.provider';
import { BROKER_ADAPTER, IBrokerAdapter } from '../broker/broker.interface';
import { TradingStateService } from '../risk/trading-state.service';
import { level2Config } from '../level2/level2.config';

const round = (n: number, dp = 2) => Math.round(n * 10 ** dp) / 10 ** dp;

/**
 * Read model for the Execution page (L2-INC-5). All served behind AdminTokenGuard
 * (L2 tables are anon-denied) via the Next server-side proxy. DEMO context.
 */
@Injectable()
export class ExecutionReadService {
  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient | null,
    @Inject(BROKER_ADAPTER) private readonly broker: IBrokerAdapter,
    private readonly state: TradingStateService,
  ) {}

  private db(): SupabaseClient {
    if (!this.supabase) throw new Error('Supabase client not configured');
    return this.supabase;
  }

  /** Open positions (DB) enriched with LIVE unrealised P/L from the broker. */
  async positions(): Promise<unknown[]> {
    const { data, error } = await this.db()
      .from('positions')
      .select('id,opened_at,timeframe,side,units,entry_price,stop_loss,take_profit,broker_trade_id,slippage_points,risk_pct_actual,achieved_rr,mode')
      .eq('status', 'OPEN')
      .order('opened_at', { ascending: false });
    if (error) throw new Error(`positions query failed: ${error.message}`);
    const live: Record<string, number> = {};
    try {
      for (const t of await this.broker.getOpenTrades()) live[t.id] = t.unrealizedPl;
    } catch {
      /* broker unreachable — show DB positions without live P/L */
    }
    return (data ?? []).map((p) => ({ ...p, live_pl: p.broker_trade_id ? live[p.broker_trade_id] ?? null : null }));
  }

  /** Order history (fills) enriched with slippage / achieved & realized R from the position. */
  async orders(): Promise<unknown[]> {
    const [{ data: orders, error }, { data: pos }] = await Promise.all([
      this.db()
        .from('orders')
        .select('id,created_at,side,units,requested_price,filled_price,status,reason,risk_pct_actual,mode')
        .order('created_at', { ascending: false })
        .limit(100),
      this.db().from('positions').select('order_id,slippage_points,achieved_rr,realized_r,close_reason,status'),
    ]);
    if (error) throw new Error(`orders query failed: ${error.message}`);
    const byOrder: Record<string, any> = {};
    for (const p of pos ?? []) if (p.order_id) byOrder[p.order_id] = p;
    return (orders ?? []).map((o) => ({
      ...o,
      slippage_points: byOrder[o.id]?.slippage_points ?? null,
      achieved_rr: byOrder[o.id]?.achieved_rr ?? null,
      realized_r: byOrder[o.id]?.realized_r ?? null,
      position_status: byOrder[o.id]?.status ?? null,
      close_reason: byOrder[o.id]?.close_reason ?? null,
    }));
  }

  /** Equity curve + daily/weekly reference + high-water mark. */
  async equity(): Promise<unknown> {
    const [{ data: snaps }, dailyRef, weeklyRef, hwm] = await Promise.all([
      this.db().from('equity_snapshots').select('ts,equity,balance,high_water_mark,snapshot_type,open_positions').order('ts', { ascending: true }).limit(1000),
      this.latestRef('DAILY_REF'),
      this.latestRef('WEEKLY_REF'),
      this.maxHwm(),
    ]);
    return { snapshots: snaps ?? [], dailyRef, weeklyRef, hwm };
  }

  async riskEvents(): Promise<unknown[]> {
    const { data, error } = await this.db()
      .from('risk_events')
      .select('created_at,event_type,severity,message,mode')
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) throw new Error(`risk_events query failed: ${error.message}`);
    return data ?? [];
  }

  /** Mode, active halts, tier status, today's/weekly P/L and loss-budget remaining. */
  async stateSummary(): Promise<unknown> {
    const cfg = level2Config();
    let equity: number | null = null;
    let ccy = cfg.demo.accountCcy;
    let openPositions = 0;
    try {
      const acc = await this.broker.getAccount();
      equity = acc.equity;
      ccy = acc.currency;
      openPositions = (await this.broker.getOpenTrades()).length;
    } catch {
      /* broker unreachable */
    }
    const [dailyRef, weeklyRef, halts, resolvedDemo] = await Promise.all([
      this.latestRef('DAILY_REF'),
      this.latestRef('WEEKLY_REF'),
      this.state.getActiveHalts(),
      this.countResolvedDemo(),
    ]);

    const budget = (ref: number | null, maxPct: number) => {
      const usedPct = ref && equity != null ? Math.max(0, ((ref - equity) / ref) * 100) : 0;
      return { usedPct: round(usedPct), maxPct, remainingPct: round(Math.max(0, maxPct - usedPct)) };
    };

    return {
      mode: cfg.tradingMode, // demo | live (drives the banner)
      autoTradeEnabled: cfg.autoTradeEnabled,
      equity,
      ccy,
      openPositions,
      todayPnl: equity != null && dailyRef ? round(equity - dailyRef) : null,
      weeklyPnl: equity != null && weeklyRef ? round(equity - weeklyRef) : null,
      dailyLossBudget: budget(dailyRef, cfg.maxDailyLossPct),
      weeklyLossBudget: budget(weeklyRef, cfg.maxWeeklyLossPct),
      halts: halts.map((h) => ({ halt_type: h.halt_type, reason: h.reason, requires_manual: h.requires_manual, scope: h.scope, clears_at: h.clears_at ?? null })),
      tier: {
        riskPerTradePct: cfg.riskPerTradePct,
        currentTier: cfg.riskPerTradePct <= 2.0 ? 1 : 2,
        resolvedDemoTrades: resolvedDemo,
        tier2Unlocked: resolvedDemo >= 50,
      },
    };
  }

  /** POST /halt — sets a MANUAL halt (mirrors Telegram /halt). No live switch exists. */
  async setManualHalt(): Promise<{ ok: true }> {
    await this.state.setHalt('MANUAL_HALT', { requiresManual: true, reason: 'manual halt (Execution page)' });
    return { ok: true };
  }

  private async latestRef(type: 'DAILY_REF' | 'WEEKLY_REF'): Promise<number | null> {
    const { data } = await this.db().from('equity_snapshots').select('equity').eq('snapshot_type', type).order('ts', { ascending: false }).limit(1);
    return data?.length ? Number(data[0].equity) : null;
  }
  private async maxHwm(): Promise<number | null> {
    const { data } = await this.db().from('equity_snapshots').select('high_water_mark').order('high_water_mark', { ascending: false }).limit(1);
    return data?.length && data[0].high_water_mark != null ? Number(data[0].high_water_mark) : null;
  }
  private async countResolvedDemo(): Promise<number> {
    const { count } = await this.db().from('positions').select('id', { count: 'exact', head: true }).eq('mode', 'demo').eq('status', 'CLOSED');
    return count ?? 0;
  }
}
