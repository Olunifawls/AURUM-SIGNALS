/** Ruleset "v1" is FROZEN. Every number here comes from the v1 spec; do not tune. */
export const RULESET_VERSION = 'v1';

export const DAY_MS = 86_400_000;
export const HOUR_MS = 3_600_000;

/** A HARD agent's data is stale when its latest complete bar is older than this. */
export const MAX_DATA_AGE_DAYS = 4;

export const EXECUTABLE_TIMEFRAME = '4h';

export const SMA_BARS = 50;
export const SMA_SLOPE_BARS = 10;
export const DOLLAR_MOMENTUM_BARS = 20;
export const YIELD_CHANGE_BARS = 20;

export const COT_WINDOW_REPORTS = 52;
export const COT_CHANGE_REPORTS = 4;
export const COT_SUPPORT_BUY_MIN = 60;
export const COT_SUPPORT_SELL_MAX = 40;
/** A report dated Tuesday is usable from report_date + 3 days 21:00 UTC. */
export const COT_USABLE_AFTER_MS = 3 * DAY_MS + 21 * HOUR_MS;

export const EVENT_RISK_HOURS = 72;
export const NEWS_EXIT_LEAD_MIN = 15;
/** SHADOW logs what closing at T-15 would have made and never closes. Set this to
 * HARD, as a new ruleset version, to close positions again. */
export type NewsExitMode = 'SHADOW' | 'HARD';
export const NEWS_EXIT_MODE = 'SHADOW' as NewsExitMode;
export const DOLLAR_SHOCK_RANGE_BARS = 20;

/** Daily data starts here; the backfill reads from this date. */
export const BACKFILL_FROM = '2025-06-01';
