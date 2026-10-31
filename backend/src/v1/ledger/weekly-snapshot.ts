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

export interface SnapshotInput {
  now: Date;
  ruleset: string;
  report: ReturnType<typeof summarise>; // the Forward Test page's numbers, unchanged
  trades: ClosedTrade[]; // demo trades closed since v1 started
  activeHalts: string[];
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
