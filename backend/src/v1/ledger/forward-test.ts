import { entryDrift, entryPriceFault, realizedR, Side } from '../../execution/exec-util';

export type NonTradeableReason = 'PAST_STOP' | 'PAST_TARGET' | 'ENTRY_DRIFT' | 'NO_FIRE_PRICE';

export interface FiredSignal {
  side: Side;
  entry: number;
  stop: number;
  target: number;
  firePrice: number | null;
}

/** The side of a quote the executor would trade at, or null for an empty quote. */
export function quotePrice(side: Side, bid: number, ask: number): number | null {
  const price = side === 'BUY' ? ask : bid;
  return price > 0 ? price : null;
}

const CANDLE_15M_MS = 15 * 60_000;

/** The close of the newest 15min candle finished by `at`. Mid price, so no spread. */
export function lastClosedCandle(candles: Array<{ ts: string; close: number | string }>, at: string): number | null {
  const by = Date.parse(at);
  const done = candles.filter((c) => Date.parse(c.ts) + CANDLE_15M_MS <= by).sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts));
  return done.length ? Number(done[0].close) : null;
}

/** Why the executor would have refused this signal at its fire price, or null if it
 * would have taken it. The executor's own checks. A known price stands for both sides
 * of the quote. No price means no trade, as it does for the executor. */
export function nonTradeableReason(s: FiredSignal, maxDriftR: number): NonTradeableReason | null {
  if (s.firePrice == null) return 'NO_FIRE_PRICE';
  const fault = entryPriceFault(s.side, s.stop, s.target, s.firePrice, s.firePrice);
  if (fault) return fault;
  return entryDrift(s.side, s.entry, s.stop, s.firePrice, s.firePrice, maxDriftR).exceeded ? 'ENTRY_DRIFT' : null;
}

/** The signal's L1 outcome, measured from the fire price, in units of the signal's
 * original risk. A better fire earns more distance; it never shrinks the unit, so the
 * result can exceed the signal's R:R, and a stop hit from a worse fire can pass -1R.
 * Null while unresolved. */
export function tradeableR(s: Pick<FiredSignal, 'side' | 'entry' | 'stop' | 'firePrice'>, resolvedPrice: number | null): number | null {
  const risk = Math.abs(s.entry - s.stop);
  if (s.firePrice == null || resolvedPrice == null || risk === 0) return null;
  const move = s.side === 'BUY' ? resolvedPrice - s.firePrice : s.firePrice - resolvedPrice;
  return Math.round((move / risk) * 100) / 100;
}

export interface SignalRisk {
  entry: number;
  stop: number;
}

/** A demo trade's R: from its fill, in the signal's original risk, the same unit as
 * tradeableR. A position with no signal keeps the fill's own risk. */
export function positionR(pos: { side: Side; fill: number; initialStop: number }, signal: SignalRisk | null | undefined, price: number): number | null {
  const original = signal ? tradeableR({ side: pos.side, entry: signal.entry, stop: signal.stop, firePrice: pos.fill }, price) : null;
  return original ?? realizedR(pos.fill, pos.initialStop, price, pos.side);
}

export interface LedgerRow {
  signalId: string;
  timeframe: string;
  createdAt: string;
  eligible: boolean;
  duplicateOf: string | null; // a repeat of an earlier setup; never counted as a setup
  agents: Array<{ agent: string; verdict: string }>;
  rMultiple: number | null; // raw L1 outcome from the signal's entry; null while open
  nonTradeable: NonTradeableReason | null; // null when the executor would have taken it
  tradeableR: number | null; // outcome from the fire price, in original risk; null while open
  resolvedAt: string | null;
}

export interface NewsExitRow {
  positionId: string;
  event: string | null;
  closedAt: string | null;
  side: 'BUY' | 'SELL';
  entry: number;
  initialStop: number;
  realizedR: number | null;
  signalResolvedPrice: number | null;
  signal?: SignalRisk | null;
}

export interface WatchRow {
  kind: 'THESIS_CHECK' | 'DOLLAR_SHOCK' | 'NEWS_EXIT_SHADOW';
  positionId: string | null;
  agent: string;
  flipped: boolean;
  barTs: string;
  price: number | null;
  side: 'BUY' | 'SELL' | null;
  entry: number | null;
  initialStop: number | null;
  finalR: number | null; // null while the trade is open
  signal?: SignalRisk | null;
}

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

/** Cumulative R by resolution day. */
function curve(rows: LedgerRow[]): Array<{ day: string; value: number }> {
  const byDay = new Map<string, number>();
  for (const r of rows) {
    if (r.rMultiple == null || !r.resolvedAt) continue;
    const day = r.resolvedAt.slice(0, 10);
    byDay.set(day, (byDay.get(day) ?? 0) + r.rMultiple);
  }
  let total = 0;
  return [...byDay.keys()].sort().map((day) => {
    total += byDay.get(day) as number;
    return { day, value: round2(total) };
  });
}

function group(rows: LedgerRow[]): { signals: number; resolved: number; wins: number; losses: number; totalR: number } {
  const done = rows.filter((r) => r.rMultiple != null);
  return {
    signals: rows.length,
    resolved: done.length,
    wins: done.filter((r) => (r.rMultiple as number) > 0).length,
    losses: done.filter((r) => (r.rMultiple as number) < 0).length,
    totalR: round2(done.reduce((a, r) => a + (r.rMultiple as number), 0)),
  };
}

function byVerdict(rows: LedgerRow[]) {
  const buckets = new Map<string, { agent: string; verdict: string; rows: LedgerRow[] }>();
  for (const r of rows) {
    for (const a of r.agents) {
      const key = `${a.agent}|${a.verdict}`;
      if (!buckets.has(key)) buckets.set(key, { agent: a.agent, verdict: a.verdict, rows: [] });
      buckets.get(key)!.rows.push(r);
    }
  }
  return [...buckets.values()]
    .map((b) => ({ agent: b.agent, verdict: b.verdict, ...group(b.rows) }))
    .sort((a, b) => a.agent.localeCompare(b.agent) || a.verdict.localeCompare(b.verdict));
}

/** What holding would have made: the signal's own L1 exit price, measured from this
 * trade's real fill and original stop. Null until the signal resolves. */
function newsExits(rows: NewsExitRow[], shadow: WatchRow[]) {
  const hard = rows.map((r) => ({
    positionId: r.positionId,
    event: r.event,
    at: r.closedAt,
    exitR: r.realizedR,
    holdR: r.signalResolvedPrice == null ? null : positionR({ side: r.side, fill: r.entry, initialStop: r.initialStop }, r.signal, r.signalResolvedPrice),
  }));
  // SHADOW: the T-15 price against what the trade really made. Null until it closes.
  const logged = watchResults(shadow).events.map((e) => ({ positionId: e.positionId, event: e.agent, at: e.barTs, exitR: e.rAtEvent, holdR: e.finalR }));
  const trades = [...hard, ...logged];
  const settled = trades.filter((t) => t.exitR != null && t.holdR != null);
  return {
    trades,
    settled: settled.length,
    exitR: round2(settled.reduce((a, t) => a + (t.exitR as number), 0)),
    holdR: round2(settled.reduce((a, t) => a + (t.holdR as number), 0)),
  };
}

/** R had the shadow signal been acted on, beside what the trade actually made. */
function watchResults(rows: WatchRow[]) {
  const events = rows.map((r) => ({
    positionId: r.positionId,
    agent: r.agent,
    barTs: r.barTs,
    price: r.price,
    rAtEvent: r.price != null && r.entry != null && r.initialStop != null && r.side ? positionR({ side: r.side, fill: r.entry, initialStop: r.initialStop }, r.signal, r.price) : null,
    finalR: r.finalR,
  }));
  const settled = events.filter((e) => e.rAtEvent != null && e.finalR != null);
  return {
    events,
    settled: settled.length,
    actedR: round2(settled.reduce((a, e) => a + (e.rAtEvent as number), 0)),
    heldR: round2(settled.reduce((a, e) => a + (e.finalR as number), 0)),
  };
}

/** One side of the headline: tradeable signals at tradeable R, raw L1 beside it. */
function side(setups: LedgerRow[]) {
  const asTraded = setups.filter((r) => !r.nonTradeable).map((r) => ({ ...r, rMultiple: r.tradeableR }));
  const raw = group(setups);
  return { ...group(asTraded), curve: curve(asTraded), raw: { signals: raw.signals, totalR: raw.totalR } };
}

export function summarise(ledger: LedgerRow[], exits: NewsExitRow[], watch: WatchRow[]) {
  const setups = ledger.filter((r) => !r.duplicateOf);
  const refused = setups.filter((r) => r.nonTradeable);
  const byReason: Partial<Record<NonTradeableReason, number>> = {};
  for (const r of refused) byReason[r.nonTradeable as NonTradeableReason] = (byReason[r.nonTradeable as NonTradeableReason] ?? 0) + 1;
  return {
    setups: setups.length,
    duplicates: ledger.length - setups.length,
    nonTradeable: { total: refused.length, byReason },
    kept: side(setups.filter((r) => r.eligible)),
    vetoed: side(setups.filter((r) => !r.eligible)),
    byVerdict: byVerdict(setups.filter((r) => !r.nonTradeable).map((r) => ({ ...r, rMultiple: r.tradeableR }))),
    newsExits: newsExits(exits, watch.filter((w) => w.kind === 'NEWS_EXIT_SHADOW')),
    thesisWatch: watchResults(watch.filter((w) => w.kind === 'THESIS_CHECK' && w.flipped)),
    dollarShock: watchResults(watch.filter((w) => w.kind === 'DOLLAR_SHOCK')),
  };
}
