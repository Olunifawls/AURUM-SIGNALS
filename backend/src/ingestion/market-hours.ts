/**
 * Gold (XAU/USD) spot market hours.
 *
 * The market is CLOSED from Friday 22:00 UTC through Sunday 22:00 UTC, and
 * OPEN the rest of the week (it trades ~24h Sun 22:00 UTC -> Fri 22:00 UTC).
 *
 * Pure function — no side effects — so it is trivial to unit test.
 */
export function isGoldMarketOpen(nowUtc: Date): boolean {
  const day = nowUtc.getUTCDay(); // 0 = Sunday .. 6 = Saturday
  const hour = nowUtc.getUTCHours();

  if (day === 6) return false; // all of Saturday
  if (day === 5 && hour >= 22) return false; // Friday from 22:00 UTC
  if (day === 0 && hour < 22) return false; // Sunday before 22:00 UTC

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
