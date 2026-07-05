/**
 * INC-5 — Backtest harness (labelled, honest sanity check).
 *
 * Walk-forward over historical 1h XAU/USD candles using the EXACT SAME pure
 * engine functions the live system uses — no forked logic:
 *   - evaluateFromCandles  (composes resolveDirection + scoreFactors +
 *                           computeLevels/computeStop — the live signal path)
 *   - resolveSignal        (the live tracker's first-touch / both-touch->SL rule)
 *   - maxLosingStreak      (the live performance metric)
 *
 * It NEVER touches the database (no reads or writes to signals / candles /
 * performance_daily), exposes NO API route or UI, and caches the historical
 * data to a gitignored local file. Run with: `npm run backtest`.
 */
import * as fs from 'fs';
import * as path from 'path';

import { Candle } from '../indicators/support-resistance';
// --- SAME pure engine modules as live (DoD e) ---
import { evaluateFromCandles } from '../signals/signal-engine';
import { resolveDirection, scoreFactors } from '../signals/factors';
import { computeLevels, computeStop } from '../signals/levels';
import { CORE_STOP, Direction, minConfluenceCore, minRrRatio } from '../signals/signals.constants';
import { resolveSignal, countTradingDays, MAX_TRADING_DAYS } from '../tracker/resolution';
import { maxLosingStreak, SignalStatus } from '../tracker/performance';

// Referenced so the reuse is explicit (and to prove no copied/forked logic).
const LIVE_ENGINE = {
  resolveDirection,
  scoreFactors,
  computeStop,
  computeLevels,
  evaluateFromCandles,
  resolveSignal,
  maxLosingStreak,
};

const CAVEAT =
  'HISTORICAL BACKTEST — overfit-prone, small sample, resolves on 1h not 15min. NOT evidence of future performance and NOT a measured live result.';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const CACHE_FILE = path.resolve(REPO_ROOT, '.cache/backtest_1h.json');
const OUTPUT_SIZE = 2000;

function parseTwelveDataTs(dt: string): string {
  const s = dt.includes(' ') ? dt.replace(' ', 'T') : dt.length === 10 ? `${dt}T00:00:00` : dt;
  return new Date(`${s}Z`).toISOString();
}

function getApiKey(): string {
  if (process.env.TWELVE_DATA_API_KEY) return process.env.TWELVE_DATA_API_KEY;
  const candidates = [
    path.resolve(REPO_ROOT, '.env'),
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), '../.env'),
  ];
  for (const p of candidates) {
    if (!fs.existsSync(p)) continue;
    const line = fs
      .readFileSync(p, 'utf8')
      .split('\n')
      .find((l) => l.startsWith('TWELVE_DATA_API_KEY='));
    if (line) {
      const v = line.slice('TWELVE_DATA_API_KEY='.length).trim();
      if (v) return v;
    }
  }
  throw new Error('TWELVE_DATA_API_KEY not found (set env var or add it to repo-root .env)');
}

async function loadCandles(): Promise<{ candles: Candle[]; fromCache: boolean }> {
  if (fs.existsSync(CACHE_FILE)) {
    const candles = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')) as Candle[];
    return { candles, fromCache: true };
  }
  const key = getApiKey();
  const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(
    'XAU/USD',
  )}&interval=1h&outputsize=${OUTPUT_SIZE}&apikey=${key}`;
  const res = await fetch(url);
  const json = (await res.json()) as {
    status?: string;
    message?: string;
    values?: Array<{ datetime: string; open: string; high: string; low: string; close: string }>;
  };
  if (json.status === 'error' || !json.values) {
    throw new Error(`Twelve Data error: ${json.message ?? 'no values'}`);
  }
  const candles: Candle[] = json.values
    .map((v) => ({
      ts: parseTwelveDataTs(v.datetime),
      open: Number(v.open),
      high: Number(v.high),
      low: Number(v.low),
      close: Number(v.close),
    }))
    .reverse(); // ascending by time
  fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
  fs.writeFileSync(CACHE_FILE, JSON.stringify(candles));
  return { candles, fromCache: false };
}

/** Aggregate 1h candles into 4h candles (higher-TF context for F1). Uses only
 * the candles passed in, so it inherits the caller's no-look-ahead cutoff. */
function aggregateTo4h(candles1h: Candle[]): Candle[] {
  const bucketMs = 4 * 3600 * 1000;
  const buckets = new Map<number, Candle[]>();
  for (const c of candles1h) {
    const start = Math.floor(new Date(c.ts).getTime() / bucketMs) * bucketMs;
    const grp = buckets.get(start);
    if (grp) grp.push(c);
    else buckets.set(start, [c]);
  }
  return [...buckets.keys()]
    .sort((a, b) => a - b)
    .map((k) => {
      const grp = buckets.get(k)!;
      return {
        ts: new Date(k).toISOString(),
        open: grp[0].open,
        high: Math.max(...grp.map((x) => x.high)),
        low: Math.min(...grp.map((x) => x.low)),
        close: grp[grp.length - 1].close,
      };
    });
}

function assertNoFuture(cs: Candle[], cutoffTs: string): void {
  for (const c of cs) {
    if (c.ts > cutoffTs) {
      throw new Error(`NO-LOOK-AHEAD VIOLATION: engine received candle ${c.ts} > cutoff ${cutoffTs}`);
    }
  }
}

function assertAllAfter(cs: Candle[], entryTs: string): void {
  for (const c of cs) {
    if (c.ts <= entryTs) {
      throw new Error(`RESOLUTION VIOLATION: used candle ${c.ts} at/before entry ${entryTs}`);
    }
  }
}

/** First index k > i whose date is more than MAX_TRADING_DAYS trading days after entry. */
function findExpiryHorizon(candles: Candle[], i: number): number | null {
  for (let k = i + 1; k < candles.length; k++) {
    if (countTradingDays(candles[i].ts, candles[k].ts) > MAX_TRADING_DAYS) return k;
  }
  return null;
}

interface Trade {
  direction: Direction;
  entryTs: string;
  resolvedTs: string;
  status: SignalStatus;
  r: number;
}

async function main(): Promise<void> {
  const { candles, fromCache } = await loadCandles();
  const N = candles.length;

  const trades: Trade[] = [];
  const openUntil: Record<Direction, string | null> = { BUY: null, SELL: null };
  let steps = 0;
  let fired = 0;
  let dupSkipped = 0;
  let unresolvedDropped = 0;

  for (let i = 250; i < N - 1; i++) {
    steps++;
    const cutoff = candles[i].ts;
    const slice = candles.slice(0, i + 1); // candles[0..i] ONLY

    // No-look-ahead assertion — runs every step.
    assertNoFuture(slice, cutoff);
    const higher = aggregateTo4h(slice);
    assertNoFuture(higher, cutoff);

    const existingOpen: Direction[] = (['BUY', 'SELL'] as Direction[]).filter(
      (d) => openUntil[d] != null && cutoff < (openUntil[d] as string),
    );

    const result = evaluateFromCandles(slice, higher, {
      minScore: minConfluenceCore(),
      minRr: minRrRatio(),
      stopFloorMult: CORE_STOP.floor,
      stopCeilMult: CORE_STOP.ceil,
      existingOpenDirections: existingOpen,
    });

    if (!result.fired) {
      if (result.reason === 'duplicate_open') dupSkipped++;
      continue;
    }
    fired++;

    const direction = result.direction as Direction;
    const lv = result.levels!;

    // Resolve on the SUBSEQUENT 1h series (documented approximation), capped at
    // the 5-trading-day expiry horizon so expiry timing matches the live rule.
    const horizon = findExpiryHorizon(candles, i);
    const endIdx = horizon ?? N - 1;
    const window = candles.slice(i + 1, endIdx + 1);
    assertAllAfter(window, cutoff);

    const res = resolveSignal(
      {
        direction,
        entryPrice: lv.entry,
        stopLoss: lv.stop,
        takeProfit: lv.takeProfit,
        entryTs: cutoff,
      },
      window,
      { now: candles[endIdx].ts },
    );

    if (!res) {
      unresolvedDropped++; // still open at end of data — excluded from stats
      continue;
    }
    openUntil[direction] = res.resolvedTs;
    trades.push({
      direction,
      entryTs: cutoff,
      resolvedTs: res.resolvedTs,
      status: res.status,
      r: res.rMultiple,
    });
  }

  // Aggregate.
  const count = trades.length;
  const wins = trades.filter((t) => t.status === 'HIT_TP').length;
  const losses = trades.filter((t) => t.status === 'HIT_SL').length;
  const expired = trades.filter((t) => t.status === 'EXPIRED').length;
  const decisive = wins + losses;
  const winRate = decisive > 0 ? (wins / decisive) * 100 : null;
  const cumR = trades.reduce((a, t) => a + t.r, 0);
  const avgR = count > 0 ? cumR / count : null;
  const orderedStatuses = [...trades]
    .sort((a, b) => (a.resolvedTs < b.resolvedTs ? -1 : 1))
    .map((t) => t.status);
  const streak = maxLosingStreak(orderedStatuses);

  const fmt = (n: number | null, d = 2) => (n == null ? 'n/a' : n.toFixed(d));

  console.log('');
  console.log('='.repeat(78));
  console.log(CAVEAT);
  console.log('='.repeat(78));
  console.log(`Data:            ${N} historical 1h XAU/USD candles${fromCache ? ' (from cache)' : ' (fetched, now cached)'}`);
  console.log(`Walk-forward:    i = 250 .. ${N - 2}  (${steps} steps)`);
  console.log(`Engine:          reused live functions -> ${Object.keys(LIVE_ENGINE).join(', ')}`);
  console.log(`No-look-ahead:   assertion ran and PASSED at all ${steps} steps`);
  console.log(`Higher-TF (F1):  4h derived by aggregating the 1h series up to i (no look-ahead)`);
  console.log('-'.repeat(78));
  console.log(`Signals fired:   ${fired}   (duplicate-direction skipped: ${dupSkipped}, unresolved@end dropped: ${unresolvedDropped})`);
  console.log(`Trades:          ${count}   (wins ${wins} / losses ${losses} / expired ${expired})`);
  console.log(`Win rate:        ${fmt(winRate)}%   (HIT_TP / decisive; EXPIRED excluded)`);
  console.log(`Average R:       ${fmt(avgR)}   (over all ${count} trades, incl. EXPIRED)`);
  console.log(`Cumulative R:    ${fmt(cumR)}`);
  console.log(`Max losing streak: ${streak}`);
  console.log('='.repeat(78));
  console.log(CAVEAT);
  console.log('='.repeat(78));
  console.log('');
}

main().catch((err) => {
  console.error('backtest failed:', err);
  process.exit(1);
});
