/** Staleness threshold for the 15min timeframe (ms). */
export const STALE_THRESHOLD_MS = 15 * 60 * 1000;

/**
 * The 15min feed is "stale" only when the market is OPEN and we have had no
 * successful 15min ingestion within the threshold. When the market is closed
 * we expect no fresh data, so it is never flagged stale.
 *
 * Pure function for easy unit testing.
 */
export function computeStale(
  last15minTs: string | null,
  now: Date,
  marketOpen: boolean,
  thresholdMs: number = STALE_THRESHOLD_MS,
): boolean {
  if (!marketOpen) return false;
  if (!last15minTs) return true; // open market, never ingested -> stale
  const ageMs = now.getTime() - new Date(last15minTs).getTime();
  return ageMs > thresholdMs;
}
