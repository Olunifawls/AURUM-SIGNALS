import { Timeframe } from '../ingestion/ingestion.constants';

export type Direction = 'BUY' | 'SELL';

export const CONFLUENCE_MAX = 6;
export const MIN_CONFLUENCE_EXPERIMENTAL = 5;

/** 4h signals require >= 200 daily candles (for the 4h -> 1day F1). */
export const DAILY_GUARD_MIN = 200;

/** Next timeframe up, used for F1 (higher-TF trend). */
export const HIGHER_TF: Record<Timeframe, Timeframe | null> = {
  '15min': '1h',
  '1h': '4h',
  '4h': '1day',
  '1day': null,
};

/** Stop clamp multipliers (floor = tightest, ceil = widest). */
export const CORE_STOP = { floor: 1.0, ceil: 2.0 };
/**
 * Experimental 15min: "stop uses 1.5×ATR with the SAME structure clamp logic".
 * We keep the two-sided structure clamp and set the WIDEST allowed stop to
 * 1.5×ATR (tighter than core's 2.0×ATR) for the fast track; the 1×ATR floor is
 * unchanged. Parameterised so the reading is trivial to adjust. (Documented.)
 */
export const EXPERIMENTAL_STOP = { floor: 1.0, ceil: 1.5 };

function num(v: string | undefined, fallback: number): number {
  const n = v != null ? Number(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

/** MIN_CONFLUENCE_SCORE (core), default 4. */
export function minConfluenceCore(): number {
  return num(process.env.MIN_CONFLUENCE_SCORE, 4);
}

/** MIN_RR_RATIO, default 2.0. */
export function minRrRatio(): number {
  return num(process.env.MIN_RR_RATIO, 2.0);
}

/** EXPERIMENTAL_15MIN_TRACK flag, default true. */
export function experimental15mEnabled(): boolean {
  return (process.env.EXPERIMENTAL_15MIN_TRACK ?? 'true').toLowerCase() !== 'false';
}
