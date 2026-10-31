import { fmtSigned, fmtSignedR } from '../../alerts/alert-format';
import { LONDON, zonedParts } from '../../common/timezone';
import { DAY_MS } from '../v1.constants';
import { summarise } from './forward-test';

/** Reporting targets, not enforced anywhere: the go-live decision stays manual. */
const GATE_WEEKS = 8;
const GATE_DEMO_TRADES = 30;

const round1 = (n: number): number => Math.round(n * 10) / 10;
const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

export interface ClosedTrade {
  closedAt: string;
  realizedR: number | null;
  slippagePoints: number | null;
}

/** A row of risk_events with type TRADING_HALTED. Most are order rejections logged on
 * every poll while halted; only those with meta.haltType are activations. */
export interface HaltEvent {
  created_at: string;
  message: string;
  meta: { haltType?: string } | null;
}

/** A row of system_halts: one per type, so it only knows that type's latest firing. */
export interface HaltRow {
  halt_type: string;
  reason: string | null;
  active: boolean;
  triggered_at: string;
  cleared_at: string | null;
}

export interface WeekHalt {
  type: string;
  reason: string | null;
  setAt: string;
  clearedAt: string | null;
  status: 'ACTIVE' | 'CLEARED' | 'CLEAR_TIME_UNKNOWN';
  timesLogged: number; // a breaker that re-fires each cycle is one activation
}

/** Breakers run every 3 minutes, so a re-fire this close is the same activation. */
const SAME_ACTIVATION_MS = 10 * 60_000;
const MATCH_ROW_MS = 60_000; // the row is written just before its risk_events row

const haltStatus = (active: boolean, clearedAt: string | null): WeekHalt['status'] =>
  active ? 'ACTIVE' : clearedAt ? 'CLEARED' : 'CLEAR_TIME_UNKNOWN';

/** Every halt in force at any point since weekStart. An older activation of a type that
 * fired again has no clear time, because system_halts kept only the newest. */
export function haltsThisWeek(events: HaltEvent[], rows: HaltRow[], weekStart: Date): WeekHalt[] {
  const start = weekStart.getTime();
  const runs: Array<WeekHalt & { lastAt: number }> = [];
  const real = events.filter((e) => e.meta?.haltType && Date.parse(e.created_at) >= start).sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
  for (const e of real) {
    const type = e.meta?.haltType as string;
    const at = Date.parse(e.created_at);
    const run = runs.filter((r) => r.type === type).pop();
    if (run && at - run.lastAt <= SAME_ACTIVATION_MS) {
      run.lastAt = at;
      run.timesLogged += 1;
      continue;
    }
    const prefix = `${type}: `;
    const reason = e.message.startsWith(prefix) ? e.message.slice(prefix.length) : e.message;
    runs.push({ type, reason, setAt: e.created_at, clearedAt: null, status: 'CLEAR_TIME_UNKNOWN', timesLogged: 1, lastAt: at });
  }

  const fromRows: WeekHalt[] = [];
  for (const row of rows) {
    const clearedAt = row.cleared_at && !row.active ? row.cleared_at : null;
    const inWeek = row.active || Date.parse(row.triggered_at) >= start || (clearedAt != null && Date.parse(clearedAt) >= start);
    if (!inWeek) continue;
    const set = Date.parse(row.triggered_at);
    const run = runs.find((r) => r.type === row.halt_type && set >= Date.parse(r.setAt) - MATCH_ROW_MS && set <= r.lastAt + MATCH_ROW_MS);
    if (run) {
      run.clearedAt = clearedAt;
      run.status = haltStatus(row.active, clearedAt);
    } else {
      // Manual halts log no risk_events row, and a halt can predate the week.
      fromRows.push({ type: row.halt_type, reason: row.reason, setAt: row.triggered_at, clearedAt, status: haltStatus(row.active, clearedAt), timesLogged: 1 });
    }
  }

  return [...runs.map(({ lastAt: _lastAt, ...h }) => h), ...fromRows].sort((a, b) => Date.parse(a.setAt) - Date.parse(b.setAt));
}

export interface SnapshotInput {
  now: Date;
  ruleset: string;
  report: ReturnType<typeof summarise>; // the Forward Test page's numbers, unchanged
  trades: ClosedTrade[]; // demo trades closed since v1 started
  activeHalts: string[];
  haltsThisWeek: WeekHalt[];
  errorsThisWeek: number;
  v1StartedAt: string | null;
  lastCalendarEvent: string | null;
  account: {
    ccy: string;
    equity: number | null;
    startOfWeekEquity: number | null;
    highWaterMark: number | null;
    openPositions: number;
  };
}

/** Real fills: R as the broker filled it, slippage as recorded at the fill. */
function tradeStats(trades: ClosedTrade[]) {
  const rs = trades.map((t) => t.realizedR).filter((r): r is number => r != null);
  const slips = trades.map((t) => t.slippagePoints).filter((s): s is number => s != null);
  return {
    count: trades.length,
    winRatePct: rs.length ? round1((rs.filter((r) => r > 0).length / rs.length) * 100) : null,
    totalR: round2(rs.reduce((a, r) => a + r, 0)),
    avgSlippagePoints: slips.length ? round2(slips.reduce((a, s) => a + s, 0) / slips.length) : null,
  };
}

function groupStats(g: { signals: number; resolved: number; wins: number; totalR: number }) {
  return {
    count: g.signals,
    resolved: g.resolved,
    winRatePct: g.resolved ? round1((g.wins / g.resolved) * 100) : null,
    totalR: g.totalR,
  };
}

const shadowStats = (w: { events: unknown[]; settled: number; actedR: number; heldR: number }) => ({
  events: w.events.length,
  settled: w.settled,
  actedR: w.actedR,
  heldR: w.heldR,
});

export function buildSnapshotPayload(i: SnapshotInput) {
  const weekStart = i.now.getTime() - 7 * DAY_MS;
  const { report: r, account: a } = i;
  const started = i.v1StartedAt ? Date.parse(i.v1StartedAt) : null;
  return {
    asOf: i.now.toISOString(),
    ruleset: i.ruleset,
    v1StartedAt: i.v1StartedAt,
    demoTrades: {
      thisWeek: tradeStats(i.trades.filter((t) => Date.parse(t.closedAt) >= weekStart)),
      sinceV1: tradeStats(i.trades),
    },
    kept: groupStats(r.kept),
    vetoed: groupStats(r.vetoed),
    raw: { kept: r.kept.raw, vetoed: r.vetoed.raw },
    byVerdict: r.byVerdict.map((v) => ({ agent: v.agent, verdict: v.verdict, resolved: v.resolved, totalR: v.totalR })),
    newsExit: { settled: r.newsExits.settled, exitR: r.newsExits.exitR, holdR: r.newsExits.holdR },
    thesisWatch: shadowStats(r.thesisWatch),
    dollarShock: shadowStats(r.dollarShock),
    setups: r.setups,
    duplicates: r.duplicates,
    nonTradeable: r.nonTradeable,
    activeHalts: i.activeHalts,
    haltsThisWeek: i.haltsThisWeek,
    errorsThisWeek: i.errorsThisWeek,
    gate: {
      weeksSinceV1: started == null ? 0 : Math.floor((i.now.getTime() - started) / (7 * DAY_MS)),
      weeksRequired: GATE_WEEKS,
      demoTrades: i.trades.length,
      demoTradesRequired: GATE_DEMO_TRADES,
    },
    calendarDaysLeft: i.lastCalendarEvent ? Math.ceil((Date.parse(i.lastCalendarEvent) - i.now.getTime()) / DAY_MS) : null,
    account: {
      ...a,
      maxDrawdownPct: a.highWaterMark && a.equity != null ? round2(((a.highWaterMark - a.equity) / a.highWaterMark) * 100) : null,
    },
  };
}

export type SnapshotPayload = ReturnType<typeof buildSnapshotPayload>;

const pct = (v: number | null): string => (v == null ? '—' : `${v.toFixed(1)}%`);
const money = (v: number | null, ccy: string): string => (v == null ? '—' : `${v.toFixed(2)} ${ccy}`);

function londonStamp(iso: string): string {
  const p = zonedParts(new Date(iso), LONDON);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(p.day)}/${pad(p.month)}/${p.year} ${pad(p.hour)}:${pad(p.minute)} London`;
}

const MAX_HALT_LINES = 10; // the full list stays in the snapshot; Telegram caps a message

function haltLines(halts: WeekHalt[] | undefined): string[] {
  if (!halts) return ['Not recorded in this snapshot'];
  if (!halts.length) return ['None'];
  const lines = halts.slice(0, MAX_HALT_LINES).flatMap((h) => {
    const end = h.status === 'ACTIVE' ? 'still active' : h.status === 'CLEARED' ? `cleared ${londonStamp(h.clearedAt as string)}` : 'clear time not recorded';
    return [`${h.type}: ${h.reason ?? 'no reason recorded'}`, `  set ${londonStamp(h.setAt)}, ${end}`];
  });
  const hidden = halts.length - MAX_HALT_LINES;
  return hidden > 0 ? [...lines, `…and ${hidden} more, in the snapshot`] : lines;
}

function tradeLine(label: string, t: SnapshotPayload['demoTrades']['thisWeek']): string {
  const slip = t.avgSlippagePoints == null ? '—' : t.avgSlippagePoints.toFixed(2);
  return `${label}: ${t.count} trades, ${pct(t.winRatePct)} wins, ${fmtSignedR(t.totalR)}, avg slippage ${slip}`;
}

function groupLine(label: string, g: SnapshotPayload['kept'], raw: { totalR: number }): string {
  return `${label}: ${g.count} signals, ${g.resolved} resolved, ${pct(g.winRatePct)} wins, ${fmtSignedR(g.totalR)} (raw L1 ${fmtSignedR(raw.totalR)})`;
}

/** The Telegram weekly report and /report: the headline of one snapshot, nothing else. */
export function formatWeeklyHeadline(p: SnapshotPayload, label: string): string {
  const a = p.account;
  return [
    `📊 AURUM Weekly — ruleset ${p.ruleset}`,
    `${label}: ${londonStamp(p.asOf)}`,
    '',
    '━━ Demo trades (real fills) ━━',
    tradeLine('This week', p.demoTrades.thisWeek),
    tradeLine('Since v1', p.demoTrades.sinceV1),
    '',
    '━━ Forward test (tradeable, each setup once) ━━',
    groupLine('Kept', p.kept, p.raw.kept),
    groupLine('Vetoed', p.vetoed, p.raw.vetoed),
    `Setups ${p.setups}, duplicates ${p.duplicates}, non-tradeable ${p.nonTradeable.total}`,
    '',
    '━━ Shadow, never acted on ━━',
    `News exit: ${p.newsExit.settled} settled, ${fmtSigned(p.newsExit.exitR, 1)}R closing vs ${fmtSigned(p.newsExit.holdR, 1)}R holding`,
    `Thesis watch: ${p.thesisWatch.events} events, ${fmtSigned(p.thesisWatch.actedR, 1)}R acted vs ${fmtSigned(p.thesisWatch.heldR, 1)}R held`,
    `Dollar shock: ${p.dollarShock.events} events, ${fmtSigned(p.dollarShock.actedR, 1)}R acted vs ${fmtSigned(p.dollarShock.heldR, 1)}R held`,
    '',
    '━━ Account ━━',
    `Equity: ${money(a.equity, a.ccy)} (start of week ${money(a.startOfWeekEquity, a.ccy)})`,
    `HWM: ${money(a.highWaterMark, a.ccy)}, drawdown ${a.maxDrawdownPct == null ? '—' : `${a.maxDrawdownPct.toFixed(2)}%`}, open positions ${a.openPositions}`,
    '',
    '━━ Halts and kill switches this week ━━',
    ...haltLines((p as Partial<SnapshotPayload>).haltsThisWeek), // rows written before this field
    '',
    '━━ Health ━━',
    `Active halts: ${p.activeHalts.join(', ') || 'none'}`,
    `Errors this week: ${p.errorsThisWeek}`,
    `Calendar: ${p.calendarDaysLeft == null ? 'unknown' : `${p.calendarDaysLeft} days left`}`,
    '',
    '━━ Go-live gate ━━',
    `Weeks since v1 start: ${p.gate.weeksSinceV1} / ${p.gate.weeksRequired}`,
    `Demo trades since v1 start: ${p.gate.demoTrades} / ${p.gate.demoTradesRequired}`,
    '',
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    'Demo results only. Not financial advice.',
  ].join('\n');
}
