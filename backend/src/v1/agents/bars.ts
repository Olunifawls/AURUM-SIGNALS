import { DAY_MS, MAX_DATA_AGE_DAYS } from '../v1.constants';
import { AgentName, AgentResult, DailyBar, Direction } from './types';

export const directionSign = (d: Direction): 1 | -1 => (d === 'BUY' ? 1 : -1);

/** Bars complete at `now`, oldest first. A daily bar counts once ts + 1 day <= now. */
export function completeBars<T extends { ts: string }>(bars: T[], now: Date): T[] {
  return bars
    .filter((b) => Date.parse(b.ts) + DAY_MS <= now.getTime())
    .sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
}

/** True when a bar is older than the v1 data-age limit. */
export function isStale(barTs: string, now: Date): boolean {
  return now.getTime() - Date.parse(barTs) > MAX_DATA_AGE_DAYS * DAY_MS;
}

export function dataMissing(agent: AgentName, hard: boolean, reason: string): AgentResult {
  return { agent, verdict: 'DATA_MISSING', hard, inputs: [], reasons: [reason] };
}

/** Complete bars, or the DATA_MISSING result to return when there are too few or
 * they are stale. A HARD agent's DATA_MISSING blocks: there is no fall back to pass. */
export function usableBars(
  agent: AgentName,
  hard: boolean,
  label: string,
  bars: DailyBar[],
  needed: number,
  now: Date,
): { bars: DailyBar[] } | { missing: AgentResult } {
  const complete = completeBars(bars, now);
  if (complete.length < needed) {
    return { missing: dataMissing(agent, hard, `${label}: ${complete.length} complete daily bars, ${needed} needed`) };
  }
  const last = complete[complete.length - 1];
  if (isStale(last.ts, now)) {
    return { missing: dataMissing(agent, hard, `${label}: latest complete bar ${last.ts} is older than ${MAX_DATA_AGE_DAYS} days`) };
  }
  return { bars: complete };
}
