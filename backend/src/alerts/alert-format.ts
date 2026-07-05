/** Unicode minus sign (U+2212) to match the typographic format spec. */
const MINUS = '−';

export type Direction = 'BUY' | 'SELL';
export type Track = 'core' | 'experimental';
export type TerminalStatus = 'HIT_TP' | 'HIT_SL' | 'EXPIRED';

export interface AlertFactors {
  F1: boolean;
  F2: boolean;
  F3: boolean;
  F4: boolean;
  F5: boolean;
  F6: boolean;
}

export interface AlertSignal {
  direction: Direction;
  timeframe: string;
  track: Track;
  score: number;
  max: number;
  entry: number;
  stop: number;
  target: number;
  rr: number;
  factors: AlertFactors;
  suggestedLots: number | null;
  riskAmountCcy: number | null;
  accountSize: number;
  accountCcy: string;
  sizingNote?: string; // fallback line when position is too small / unavailable
}

export interface AlertResolution {
  status: TerminalStatus;
  direction: Direction;
  timeframe: string;
  entry: number;
  rMultiple: number;
}

function group(intStr: string): string {
  return intStr.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function fmtNum(n: number, dec: number): string {
  const [i, d] = Math.abs(n).toFixed(dec).split('.');
  const g = group(i);
  return dec > 0 ? `${g}.${d}` : g;
}

export function fmtPrice(n: number): string {
  return (n < 0 ? MINUS : '') + fmtNum(n, 2);
}
export function fmtInt(n: number): string {
  return (n < 0 ? MINUS : '') + fmtNum(n, 0);
}
export function fmtSigned(n: number, dec: number): string {
  return (n >= 0 ? '+' : MINUS) + fmtNum(n, dec);
}
export function fmtSignedR(n: number): string {
  return `${fmtSigned(n, 1)}R`;
}

function ccySymbol(ccy: string): string {
  return ccy === 'GBP' ? '£' : `${ccy} `;
}

const DISCLAIMER = '⚠️ Analysis only — not financial advice. Manual execution.';

/** Whether a signal on this track should raise a signal alert. */
export function shouldAlertSignal(track: Track, alert15mEnabled: boolean): boolean {
  return track === 'core' ? true : alert15mEnabled;
}

export function formatNewSignal(s: AlertSignal): string {
  const c = (b: boolean) => (b ? '✓' : '✗');
  const stopDelta = s.stop - s.entry;
  const targetDelta = s.target - s.entry;
  const sym = ccySymbol(s.accountCcy);

  let sizingLine: string;
  if (s.suggestedLots && s.suggestedLots > 0 && s.riskAmountCcy != null) {
    const pct = s.accountSize > 0 ? (s.riskAmountCcy / s.accountSize) * 100 : 0;
    sizingLine = `Your size: ${s.suggestedLots.toFixed(2)} lots  (risking ~${sym}${fmtNum(
      s.riskAmountCcy,
      2,
    )} ≈ ${pct.toFixed(1)}% of ${sym}${fmtInt(s.accountSize)})`;
  } else {
    sizingLine = s.sizingNote ?? 'Your size: POSITION TOO SMALL — do not force this trade.';
  }

  return [
    `🟡 GOLD SIGNAL — ${s.direction} (${s.timeframe})`,
    `Confluence: ${s.score}/${s.max} ✅`,
    `${'Entry:'.padEnd(8)}${fmtPrice(s.entry)}`,
    `${'Stop:'.padEnd(8)}${fmtPrice(s.stop)}  (${fmtSigned(stopDelta, 2)})`,
    `${'Target:'.padEnd(8)}${fmtPrice(s.target)}  (${fmtSigned(targetDelta, 2)})`,
    `R:R = ${s.rr.toFixed(1)}`,
    `Factors: Trend HTF ${c(s.factors.F1)} Trend ${c(s.factors.F2)} RSI ${c(s.factors.F3)} MACD ${c(
      s.factors.F4,
    )} Structure ${c(s.factors.F5)} Momentum ${c(s.factors.F6)}`,
    sizingLine,
    DISCLAIMER,
  ].join('\n');
}

export function formatResolution(r: AlertResolution): string {
  const emoji = r.status === 'HIT_TP' ? '✅' : r.status === 'HIT_SL' ? '❌' : '⏳';
  const label = r.status === 'HIT_TP' ? 'TP HIT' : r.status === 'HIT_SL' ? 'SL HIT' : 'EXPIRED';
  return `${emoji} ${label} — ${r.direction} ${r.timeframe} from ${fmtPrice(r.entry)} → ${fmtSignedR(
    r.rMultiple,
  )}`;
}

export function formatAdminError(source: string, message: string): string {
  return `🔴 ADMIN ALERT — ERROR in ${source}\n${message}`;
}

export const HEARTBEAT_MESSAGE = '⚠️ DATA FEED DOWN — no successful ingestion in over 20 minutes.';
export const HEARTBEAT_THRESHOLD_MIN = 20;

/** True when the data feed is stale (market open + no ingestion within threshold). */
export function isFeedStale(
  lastIngestionTs: string | null,
  now: Date,
  marketOpen: boolean,
  thresholdMin: number = HEARTBEAT_THRESHOLD_MIN,
): boolean {
  if (!marketOpen) return false;
  if (!lastIngestionTs) return true;
  return now.getTime() - new Date(lastIngestionTs).getTime() > thresholdMin * 60_000;
}

/** Canonical sample used by the /api/alerts/test endpoint and the formatter test. */
export const SAMPLE_ALERT_SIGNAL: AlertSignal = {
  direction: 'BUY',
  timeframe: '4h',
  track: 'core',
  score: 5,
  max: 6,
  entry: 2341.2,
  stop: 2332.8,
  target: 2358.0,
  rr: 2.0,
  factors: { F1: true, F2: true, F3: true, F4: true, F5: true, F6: false },
  suggestedLots: 0.02,
  riskAmountCcy: 13.4,
  accountSize: 2000,
  accountCcy: 'GBP',
};
