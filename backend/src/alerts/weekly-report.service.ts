import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../supabase/supabase.provider';
import { BROKER_ADAPTER, IBrokerAdapter } from '../broker/broker.interface';
import { AlertsService } from './alerts.service';

/**
 * Weekly performance report sent to the owner's Telegram every Sunday ~18:00 UK.
 * Cron fires at 17:00 UTC (= 18:00 BST in summer; 17:00 GMT in winter — off by
 * 1h in winter, acceptable for a weekly digest).
 *
 * Also callable on demand via the Telegram /report command.
 * All numbers are factual ledger data — no projections.
 */
@Injectable()
export class WeeklyReportService {
  private readonly logger = new Logger('WeeklyReport');

  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient | null,
    @Inject(BROKER_ADAPTER) private readonly broker: IBrokerAdapter,
    private readonly alerts: AlertsService,
  ) {}

  @Cron('0 17 * * 0')
  async scheduledReport(): Promise<void> {
    if (!this.supabase) return;
    try {
      const text = await this.buildReport(new Date());
      await this.alerts.send(text);
      this.logger.log('weekly report sent');
    } catch (err) {
      this.logger.error(`weekly report failed: ${String(err)}`);
    }
  }

  /** Build the full report text. Exported for unit testing. */
  async buildReport(now: Date): Promise<string> {
    if (!this.supabase) return '(no database)';

    // "This week" = last 7 days (covers Mon–Sun regardless of cron run time).
    const sowIso = new Date(now.getTime() - 7 * 24 * 3600_000).toISOString();

    const [
      weeklyTrades,
      allResolvedCount,
      openPositions,
      weeklyHaltRows,
      sowSnapshot,
      hwmSnapshot,
      weeklySignals,
      allCoreSignals,
      liveAccount,
    ] = await Promise.all([
      // Resolved demo trades closed THIS week
      this.supabase
        .from('positions')
        .select('realized_r,realized_pl,side,mode')
        .eq('mode', 'demo')
        .eq('status', 'CLOSED')
        .gte('closed_at', sowIso),
      // Total resolved demo trades (all-time, for go-live gate N/30)
      this.supabase
        .from('positions')
        .select('id', { count: 'exact', head: true })
        .eq('mode', 'demo')
        .eq('status', 'CLOSED'),
      // Currently open positions
      this.supabase
        .from('positions')
        .select('id,side,realized_pl,mode')
        .eq('mode', 'demo')
        .eq('status', 'OPEN'),
      // Kill-switch activations this week (TRADING_HALTED risk_events)
      this.supabase
        .from('risk_events')
        .select('event_type,message,created_at')
        .eq('event_type', 'TRADING_HALTED')
        .gte('created_at', sowIso),
      // Start-of-week equity reference
      this.supabase
        .from('equity_snapshots')
        .select('equity,ts')
        .eq('snapshot_type', 'WEEKLY_REF')
        .order('ts', { ascending: false })
        .limit(1),
      // HWM
      this.supabase
        .from('equity_snapshots')
        .select('high_water_mark')
        .order('high_water_mark', { ascending: false })
        .limit(1),
      // Core signals fired this week
      this.supabase
        .from('signals')
        .select('id,status')
        .eq('track', 'core')
        .gte('created_at', sowIso),
      // All-time core signal win rate
      this.supabase
        .from('signals')
        .select('id,status')
        .eq('track', 'core')
        .in('status', ['HIT_TP', 'HIT_SL']),
      // Live broker equity + unrealised
      this.broker.getAccount().catch(() => null),
    ]);

    // ── Trades this week ──
    const trades = weeklyTrades.data ?? [];
    const wins = trades.filter((t) => Number(t.realized_r) > 0).length;
    const losses = trades.filter((t) => Number(t.realized_r) < 0).length;
    const breakEvens = trades.length - wins - losses;
    const winRate = trades.length > 0 ? ((wins / trades.length) * 100).toFixed(1) : '—';
    const rs = trades.map((t) => Number(t.realized_r)).filter((r) => !isNaN(r));
    const avgR = rs.length ? (rs.reduce((a, b) => a + b, 0) / rs.length).toFixed(2) : '—';
    const cumR = rs.length ? rs.reduce((a, b) => a + b, 0).toFixed(2) : '—';
    const bestR = rs.length ? Math.max(...rs).toFixed(2) : '—';
    const worstR = rs.length ? Math.min(...rs).toFixed(2) : '—';
    const weeklyRealizedPl = trades.reduce((s, t) => s + Number(t.realized_pl || 0), 0);

    // ── Equity ──
    const ccy = liveAccount?.currency ?? 'GBP';
    const currentEquity = liveAccount?.equity ?? null;
    const unrealised = liveAccount?.unrealizedPl ?? null;
    const sowEquity = sowSnapshot.data?.[0]?.equity ? Number(sowSnapshot.data[0].equity) : null;
    const hwm = hwmSnapshot.data?.[0]?.high_water_mark ? Number(hwmSnapshot.data[0].high_water_mark) : null;
    const maxDrawdownPct =
      hwm && currentEquity != null && hwm > 0
        ? (((hwm - currentEquity) / hwm) * 100).toFixed(2)
        : '—';

    // ── Go-live gate ──
    const resolvedTotal = allResolvedCount.count ?? 0;
    const resolvedPct = resolvedTotal > 0 ? Math.min(100, Math.round((resolvedTotal / 30) * 100)) : 0;

    // ── Kill-switch activations ──
    const haltRows = weeklyHaltRows.data ?? [];
    const haltTypes: Record<string, number> = {};
    for (const h of haltRows) {
      const t = (h.message as string).split(':')[0] ?? 'HALT';
      haltTypes[t] = (haltTypes[t] ?? 0) + 1;
    }
    const haltLines =
      Object.entries(haltTypes)
        .map(([k, v]) => `  ${k}: ${v}×`)
        .join('\n') || '  None';

    // ── L1 signals ──
    const weekSigs = weeklySignals.data ?? [];
    const allCoreSigs = allCoreSignals.data ?? [];
    const coreWins = allCoreSigs.filter((s) => s.status === 'HIT_TP').length;
    const coreTotal = allCoreSigs.length;
    const coreWinRate = coreTotal > 0 ? ((coreWins / coreTotal) * 100).toFixed(1) : '—';

    // ── Format ──
    const dateStr = now.toLocaleDateString('en-GB', { timeZone: 'Europe/London', day: '2-digit', month: 'short', year: 'numeric' });
    const fmt = (v: number | null, dp = 2) => (v != null ? v.toFixed(dp) : '—');
    const signedFmt = (v: number | null, dp = 2) =>
      v != null ? (v >= 0 ? `+${v.toFixed(dp)}` : v.toFixed(dp)) : '—';

    return [
      `📊 AURUM Weekly Report — w/e ${dateStr}`,
      '',
      '━━ Executed Trades (Demo, last 7 days) ━━',
      `Trades: ${trades.length}`,
      `Win / Loss / B/E: ${wins} / ${losses} / ${breakEvens}`,
      `Win rate: ${winRate}%`,
      `Avg R: ${avgR !== '—' ? (Number(avgR) >= 0 ? '+' : '') + avgR : '—'}`,
      `Cumulative R: ${cumR !== '—' ? (Number(cumR) >= 0 ? '+' : '') + cumR : '—'}`,
      `Best: ${bestR !== '—' ? (Number(bestR) >= 0 ? '+' : '') + bestR + 'R' : '—'}  Worst: ${worstR !== '—' ? (Number(worstR) >= 0 ? '+' : '') + worstR + 'R' : '—'}`,
      '',
      '━━ P/L & Positions ━━',
      `Realized P/L (week): ${signedFmt(weeklyRealizedPl)} ${ccy}`,
      `Open positions: ${openPositions.data?.length ?? 0}`,
      `Unrealised P/L: ${unrealised != null ? signedFmt(unrealised) + ' ' + ccy : '—'}`,
      '',
      '━━ Equity ━━',
      `Start of week: ${fmt(sowEquity)} ${ccy}`,
      `Current: ${fmt(currentEquity)} ${ccy}`,
      `HWM: ${fmt(hwm)} ${ccy}`,
      `Max drawdown: ${maxDrawdownPct}%`,
      '',
      '━━ Kill-switch Activations (week) ━━',
      haltLines,
      `Total: ${haltRows.length}`,
      '',
      '━━ Go-live Gate ━━',
      `Resolved demo trades: ${resolvedTotal} / 30 (${resolvedPct}%)`,
      '',
      '━━ L1 Core Signals ━━',
      `Signals this week: ${weekSigs.length}`,
      `Win rate (all-time core, resolved): ${coreWinRate}% (${coreWins}/${coreTotal})`,
      '',
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      'Demo results only. Not financial advice.',
    ].join('\n');
  }
}
