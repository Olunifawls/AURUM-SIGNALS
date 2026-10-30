import { NEW_YORK, zonedParts } from '../common/timezone';

/**
 * Gold (XAU/USD) spot market hours.
 *
 * The market closes at 17:00 New York on Friday and reopens at 17:00 New York on
 * Sunday. In UTC that is 22:00 in winter and 21:00 during US daylight saving.
 *
 * Pure function — no side effects — so it is trivial to unit test.
 */
export function isGoldMarketOpen(nowUtc: Date): boolean {
  const { weekday, hour } = zonedParts(nowUtc, NEW_YORK);

  if (weekday === 6) return false; // all of Saturday
  if (weekday === 5 && hour >= 17) return false; // Friday from 17:00 New York
  if (weekday === 0 && hour < 17) return false; // Sunday before 17:00 New York

  return true;
}

/**
 * Combined market gate used by BOTH the circuit breaker and the heartbeat so
 * the two paths can never silently diverge.
 *
 * calendarOpen — result of isGoldMarketOpen(now)
 * tradeable    — OANDA's live XAU_USD 'tradeable' flag (false during the
 *                ~1h daily OANDA demo break, ~21:00–22:00 UTC weekdays)
 */
export function isMarketTradeableNow(calendarOpen: boolean, tradeable: boolean): boolean {
  return calendarOpen && tradeable;
}
