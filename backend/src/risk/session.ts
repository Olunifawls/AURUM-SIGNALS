import { isGoldMarketOpen } from '../ingestion/market-hours';

/**
 * Session timing (check 3). The gold week opens Sun 22:00 UTC and closes Fri
 * 22:00 UTC. Avoid the first 2h after the weekly open and the last 2h before
 * the weekly close (thin liquidity). Pure function of `now`.
 */
export const SESSION_EDGE_HOURS = 2;

export function sessionFlags(now: Date): {
  marketOpen: boolean;
  inFirstWindow: boolean;
  inLastWindow: boolean;
} {
  const marketOpen = isGoldMarketOpen(now);
  const day = now.getUTCDay(); // 0 Sun .. 6 Sat
  const hour = now.getUTCHours();

  // First 2h after weekly open (Sun 22:00–24:00 UTC).
  const inFirstWindow = day === 0 && hour >= 22;
  // Last 2h before weekly close (Fri 20:00–22:00 UTC).
  const inLastWindow = day === 5 && hour >= 20 && hour < 22;

  return { marketOpen, inFirstWindow, inLastWindow };
}
