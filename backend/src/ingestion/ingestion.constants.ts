/**
 * INC-1 ingestion configuration. Symbols are locked for Level 1.
 */
export const SYMBOL = 'XAU/USD';
export const FX_PAIR = 'GBP/USD';

export const TIMEFRAMES = ['15min', '1h', '4h', '1day'] as const;
export type Timeframe = (typeof TIMEFRAMES)[number];

/** Twelve Data outputsize per fetch (INC-2 indicators need >= 250 candles). */
export const OUTPUT_SIZE = 300;

/** Provider names used for circuit breakers / rate budget / health. */
export const PROVIDER_TWELVE_DATA = 'twelvedata';
export const PROVIDER_GOLD_API = 'goldapi';
/** FIX-1: OANDA is now the single candle/FX source. */
export const PROVIDER_OANDA = 'oanda';

/** Source string used for system_events rows written by this module. */
export const EVENT_SOURCE = 'ingestion';

/**
 * Nominal cron firings per day (assuming a fully-open market day). Used only
 * for the rate-budget estimate/rollup — real usage is lower because the
 * market-hours gate skips weekend cycles.
 *
 *   15min -> every 5 minutes   = 288
 *   1h    -> every 15 minutes  =  96
 *   4h    -> hourly            =  24
 *   1day  -> once daily        =   1
 *   fx    -> every 30 minutes  =  48
 */
export const CADENCE_PER_DAY: Record<Timeframe | 'fx', number> = {
  '15min': 288,
  '1h': 96,
  '4h': 24,
  '1day': 1,
  fx: 48,
};

/** Twelve Data free tier: 800 credits/day, 8 req/min. */
export const TWELVE_DATA_DAILY_LIMIT = 800;

/** Nominal calls on a fully-open 24h market day (Mon–Thu). */
export function estimateDailyTwelveDataCalls(): number {
  return Object.values(CADENCE_PER_DAY).reduce((a, b) => a + b, 0);
}

/**
 * Market-open fraction of the week: open Sun 22:00 UTC -> Fri 22:00 UTC = 120h
 * of 168h = 5/7. This is the true weekly average once the market-hours gate
 * skips weekend cycles.
 */
export const MARKET_OPEN_WEEK_FRACTION = 120 / 168;

/** Realistic weekly-average calls/day accounting for the market-hours gate. */
export function estimateGatedDailyTwelveDataCalls(): number {
  return Math.round(estimateDailyTwelveDataCalls() * MARKET_OPEN_WEEK_FRACTION);
}
