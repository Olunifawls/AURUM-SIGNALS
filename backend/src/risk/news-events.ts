/**
 * Committed config list of high-impact USD events (FOMC/CPI) for the fallback
 * news calendar. Times are UTC. NFP is computed dynamically (first Friday 13:30
 * UK) in news.ts — it is not listed here.
 */
export interface ConfigNewsEvent {
  name: string;
  at: string; // UTC ISO
}

export const NEWS_EVENTS: ConfigNewsEvent[] = [
  { name: 'CPI', at: '2026-07-14T12:30:00Z' },
  { name: 'FOMC', at: '2026-07-29T18:00:00Z' },
  { name: 'CPI', at: '2026-08-12T12:30:00Z' },
  { name: 'FOMC', at: '2026-09-16T18:00:00Z' },
  { name: 'CPI', at: '2026-09-11T12:30:00Z' },
];
