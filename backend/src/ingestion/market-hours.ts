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
