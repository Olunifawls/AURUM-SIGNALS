import { realizedR } from '../../execution/exec-util';

export interface LedgerRow {
  signalId: string;
  timeframe: string;
  createdAt: string;
  eligible: boolean;
  agents: Array<{ agent: string; verdict: string }>;
  rMultiple: number | null; // L1 outcome; null while the signal is open
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
}

export interface WatchRow {
  kind: 'THESIS_CHECK' | 'DOLLAR_SHOCK';
  positionId: string | null;
  agent: string;
  flipped: boolean;
  barTs: string;
  price: number | null;
  side: 'BUY' | 'SELL' | null;
  entry: number | null;
  initialStop: number | null;
  finalR: number | null; // null while the trade is open
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
function newsExits(rows: NewsExitRow[]) {
  const trades = rows.map((r) => ({
    positionId: r.positionId,
    event: r.event,
    closedAt: r.closedAt,
    exitR: r.realizedR,
    holdR: r.signalResolvedPrice == null ? null : realizedR(r.entry, r.initialStop, r.signalResolvedPrice, r.side),
  }));
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
    rAtEvent: r.price != null && r.entry != null && r.initialStop != null && r.side ? realizedR(r.entry, r.initialStop, r.price, r.side) : null,
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

export function summarise(ledger: LedgerRow[], exits: NewsExitRow[], watch: WatchRow[]) {
  const kept = ledger.filter((r) => r.eligible);
  const vetoed = ledger.filter((r) => !r.eligible);
  return {
    kept: { ...group(kept), curve: curve(kept) },
    vetoed: { ...group(vetoed), curve: curve(vetoed) },
    byVerdict: byVerdict(ledger),
    newsExits: newsExits(exits),
    thesisWatch: watchResults(watch.filter((w) => w.kind === 'THESIS_CHECK' && w.flipped)),
    dollarShock: watchResults(watch.filter((w) => w.kind === 'DOLLAR_SHOCK')),
  };
}
