/**
 * EXIT-RULE RESEARCH HARNESS
 *
 * Retrospectively replays real price data for every resolved L1 signal and
 * compares five exit rules. RESEARCH/ANALYSIS ONLY — never changes live
 * trading behaviour and never writes to the trading ledger.
 *
 * Run with: npm run exit-research
 */
import { WebSocket as WsWebSocket } from 'ws';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { loadRepoEnv } from '../load-env';
import { computePathMetrics, PathMetrics } from './path-metrics';
import { simulateExit, ExitRuleId, ExitSimResult } from './exit-rules';
import { Candle15 } from '../tracker/resolution';

// Node 20 has no global WebSocket; the Supabase SDK needs one.
const g = globalThis as { WebSocket?: unknown };
if (typeof g.WebSocket === 'undefined') g.WebSocket = WsWebSocket;

loadRepoEnv();

const SYMBOL = process.env.SIGNAL_SYMBOL ?? 'XAUUSD';
const RULES: ExitRuleId[] = ['BASELINE', 'CURRENT', 'RATCHET', 'PARTIAL', 'REVERSAL_EXIT'];
const RULE_LABELS: Record<ExitRuleId, string> = {
  BASELINE:     'A BASELINE     — fixed 2:1, no BE',
  CURRENT:      'B CURRENT      — BE at +1R, hold to 2R',
  RATCHET:      'C RATCHET      — BE at +1R, stop→+1R at +1.5R',
  PARTIAL:      'D PARTIAL      — 50% at +1R, 50% to 2R+BE',
  REVERSAL_EXIT:'E REVERSAL_EXIT— ≥+1.5R exit on first bearish close',
};

const CAVEAT_SHORT = 'SIMULATED / HISTORICAL — replayed on 15min candles.';

interface ResolvedSignal {
  id: string;
  direction: 'BUY' | 'SELL';
  entry_price: number;
  stop_loss: number;
  take_profit: number;
  created_at: string;
  resolved_at: string;
  status: string;
}

async function fetchResolvedSignals(supabase: SupabaseClient): Promise<ResolvedSignal[]> {
  const { data, error } = await supabase
    .from('signals')
    .select('id,direction,entry_price,stop_loss,take_profit,created_at,resolved_at,status')
    .eq('symbol', SYMBOL)
    .in('status', ['HIT_TP', 'HIT_SL', 'EXPIRED'])
    .order('created_at', { ascending: true });
  if (error) throw new Error(`signals query failed: ${error.message}`);
  return (data ?? []).map((r: Record<string, unknown>) => ({
    id: r.id as string,
    direction: r.direction as 'BUY' | 'SELL',
    entry_price: Number(r.entry_price),
    stop_loss: Number(r.stop_loss),
    take_profit: Number(r.take_profit),
    created_at: r.created_at as string,
    resolved_at: r.resolved_at as string,
    status: r.status as string,
  }));
}

async function fetchCandles(
  supabase: SupabaseClient,
  afterTs: string,
  upToTs: string,
): Promise<Candle15[]> {
  const { data, error } = await supabase
    .from('candles')
    .select('ts,open,high,low,close')
    .eq('symbol', SYMBOL)
    .eq('timeframe', '15min')
    .gt('ts', afterTs)
    .lte('ts', upToTs)
    .order('ts', { ascending: true })
    .limit(5000);
  if (error) throw new Error(`candles query failed: ${error.message}`);
  return (data ?? []).map((r: Record<string, unknown>) => ({
    ts: r.ts as string,
    open: Number(r.open),
    high: Number(r.high),
    low: Number(r.low),
    close: Number(r.close),
  }));
}

interface RuleStats {
  results: ExitSimResult[];
  winRate: number | null;
  avgR: number | null;
  cumR: number;
  maxDd: number;
}

function computeStats(results: ExitSimResult[]): RuleStats {
  const n = results.length;
  if (n === 0) return { results: [], winRate: null, avgR: null, cumR: 0, maxDd: 0 };

  const wins = results.filter((r) => r.rMultiple > 0).length;
  const cumR = results.reduce((a, r) => a + r.rMultiple, 0);

  let peak = 0, maxDd = 0, running = 0;
  for (const r of results) {
    running += r.rMultiple;
    if (running > peak) peak = running;
    const dd = peak - running;
    if (dd > maxDd) maxDd = dd;
  }

  return {
    results,
    winRate: n > 0 ? (wins / n) * 100 : null,
    avgR: n > 0 ? cumR / n : null,
    cumR,
    maxDd,
  };
}

function fmt(n: number | null, decimals = 2): string {
  if (n == null) return 'n/a';
  const s = n.toFixed(decimals);
  return n >= 0 ? `+${s}` : s;
}

function pad(s: string, width: number): string {
  return s.padEnd(width);
}

function padl(s: string, width: number): string {
  return s.padStart(width);
}

async function main(): Promise<void> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');

  const supabase = createClient(url, key);

  const signals = await fetchResolvedSignals(supabase);
  const n = signals.length;

  const W = 80;
  console.log('');
  console.log('='.repeat(W));
  console.log(CAVEAT_SHORT);
  console.log(`EXIT-RULE RESEARCH HARNESS  —  ${SYMBOL}  (demo signals)`);
  console.log('='.repeat(W));

  if (n === 0) {
    console.log('No resolved L1 signals found (HIT_TP / HIT_SL / EXPIRED).');
    console.log('The machinery is in place. Rerun after signals resolve.');
    console.log('='.repeat(W));
    console.log('');
    return;
  }

  const sampleWarning = n < 30 ? `[n=${n} — NOISE LEVEL. Below n=30 results are NOT evidence.]` : `[n=${n}]`;
  console.log(`Sample: ${n} resolved signal${n > 1 ? 's' : ''}  ${sampleWarning}`);
  console.log('');

  // Per-signal: candles + path metrics + 5 exit simulations.
  const ruleResultsMap: Record<ExitRuleId, ExitSimResult[]> = {
    BASELINE: [], CURRENT: [], RATCHET: [], PARTIAL: [], REVERSAL_EXIT: [],
  };
  const allPathMetrics: PathMetrics[] = [];

  for (const sig of signals) {
    const candles = await fetchCandles(supabase, sig.created_at, sig.resolved_at);
    if (candles.length === 0) continue;

    const pm = computePathMetrics(sig.direction, sig.entry_price, sig.stop_loss, candles);
    allPathMetrics.push(pm);

    for (const rule of RULES) {
      const res = simulateExit(rule, sig.direction, sig.entry_price, sig.stop_loss, sig.take_profit, candles);
      ruleResultsMap[rule].push(res);
    }
  }

  // Print comparison table.
  const hdr = `${'Rule'.padEnd(48)} ${'Trades'.padStart(6)} ${'Win%'.padStart(6)} ${'Avg R'.padStart(7)} ${'Cum R'.padStart(7)} ${'MaxDD'.padStart(6)}`;
  console.log(hdr);
  console.log('-'.repeat(W));

  for (const rule of RULES) {
    const stats = computeStats(ruleResultsMap[rule]);
    const ct = stats.results.length;
    const row = [
      pad(RULE_LABELS[rule], 48),
      padl(String(ct), 6),
      padl(stats.winRate != null ? `${stats.winRate.toFixed(1)}%` : 'n/a', 6),
      padl(fmt(stats.avgR), 7),
      padl(fmt(stats.cumR), 7),
      padl(fmt(-stats.maxDd), 6),
    ].join(' ');
    console.log(row);
  }
  console.log('-'.repeat(W));

  // Headline: +1.5R analysis.
  const reached15 = allPathMetrics.filter((m) => m.cross_1_5r_ts !== null);
  const r15n = reached15.length;
  console.log('');
  console.log(`HEADLINE: Of ${r15n} signal${r15n !== 1 ? 's' : ''} that reached +1.5R (of ${n} total):`);

  if (r15n === 0) {
    console.log('  No signals reached +1.5R yet.');
  } else {
    // retraced_from_1_5r = true  → retraced to +1R before +2R
    // retraced_from_1_5r = false AND cross_2r_ts set → continued to +2R
    // retraced_from_1_5r = false AND cross_2r_ts null → expired between +1.5R and +2R
    const retraced     = reached15.filter((m) => m.retraced_from_1_5r === true).length;
    const wentTo2r     = reached15.filter((m) => m.retraced_from_1_5r === false && m.cross_2r_ts !== null).length;
    const neither      = r15n - retraced - wentTo2r;

    const pct = (k: number) => (r15n > 0 ? `${((k / r15n) * 100).toFixed(1)}%` : 'n/a');

    console.log(`  → Continued to +2R (without first retracing to +1R): ${wentTo2r} (${pct(wentTo2r)})`);
    console.log(`  → Retraced to +1R or below before +2R:                ${retraced} (${pct(retraced)})`);
    console.log(`  → Expired between +1.5R and +2R (neither):            ${neither} (${pct(neither)})`);
  }

  // Additional: reached +1R analysis.
  const reached1 = allPathMetrics.filter((m) => m.cross_1r_ts !== null);
  const r1n = reached1.length;
  if (r1n > 0) {
    const retraced1 = reached1.filter((m) => m.retraced_from_1r === true).length;
    const cont1     = reached1.filter((m) => m.retraced_from_1r === false && m.cross_1_5r_ts !== null).length;
    const neither1  = r1n - retraced1 - cont1;
    const pct = (k: number) => (r1n > 0 ? `${((k / r1n) * 100).toFixed(1)}%` : 'n/a');
    console.log('');
    console.log(`Of ${r1n} signal${r1n !== 1 ? 's' : ''} that reached +1R:`);
    console.log(`  → Continued to +1.5R (no retrace to BE first):    ${cont1} (${pct(cont1)})`);
    console.log(`  → Retraced to breakeven (entry) or below first:   ${retraced1} (${pct(retraced1)})`);
    console.log(`  → Expired between +1R and +1.5R (neither):        ${neither1} (${pct(neither1)})`);
  }

  // Exit reason breakdown per rule.
  console.log('');
  console.log('Exit reason breakdown:');
  for (const rule of RULES) {
    const results = ruleResultsMap[rule];
    if (results.length === 0) continue;
    const counts: Record<string, number> = {};
    for (const r of results) counts[r.exitReason] = (counts[r.exitReason] ?? 0) + 1;
    const parts = Object.entries(counts).map(([k, v]) => `${k}:${v}`).join('  ');
    console.log(`  ${RULE_LABELS[rule].slice(0, 12).trim()}  ${parts}`);
  }

  console.log('');
  if (n < 30) {
    console.log(`⚠ n=${n} is below the n=30 minimum for any statistical confidence.`);
    console.log('  These numbers are illustrative only. Do NOT use them to change exit rules.');
    console.log('  The machinery is in place — results will sharpen as signals accumulate.');
  }
  console.log('='.repeat(W));
  console.log(CAVEAT_SHORT);
  console.log('='.repeat(W));
  console.log('');
}

main().catch((err: unknown) => {
  console.error('exit-research failed:', err);
  process.exit(1);
});
