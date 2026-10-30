import { NEW_YORK, zonedParts } from '../common/timezone';
import { isGoldMarketOpen, WEEK_EDGE_HOUR_NY } from '../ingestion/market-hours';

/**
 * Session timing (check 3). The gold week opens Sun 17:00 New York and closes Fri
 * 17:00 New York. Avoid the first 2h after the weekly open and the last 2h before
 * the weekly close (thin liquidity). Pure function of `now`.
 */
export const SESSION_EDGE_HOURS = 2;

export function sessionFlags(now: Date): {
  marketOpen: boolean;
  inFirstWindow: boolean;
  inLastWindow: boolean;
} {
  const marketOpen = isGoldMarketOpen(now);
  const { weekday, hour } = zonedParts(now, NEW_YORK);

  // First 2h after weekly open (Sun 17:00–19:00 New York).
  const inFirstWindow = weekday === 0 && hour >= WEEK_EDGE_HOUR_NY && hour < WEEK_EDGE_HOUR_NY + SESSION_EDGE_HOURS;
  // Last 2h before weekly close (Fri 15:00–17:00 New York).
  const inLastWindow = weekday === 5 && hour >= WEEK_EDGE_HOUR_NY - SESSION_EDGE_HOURS && hour < WEEK_EDGE_HOUR_NY;

  return { marketOpen, inFirstWindow, inLastWindow };
}
