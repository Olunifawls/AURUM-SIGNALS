export type SignalStatus = 'OPEN' | 'HIT_TP' | 'HIT_SL' | 'EXPIRED' | 'INVALIDATED';

export interface RollupInput {
  createdDate: string; // YYYY-MM-DD (UTC)
  resolvedDate: string | null; // YYYY-MM-DD (UTC) or null if unresolved
  status: SignalStatus;
  rMultiple: number | null; // null if unresolved
}

export interface PerformanceDay {
  day: string;
  signals_generated: number;
  wins: number;
  losses: number;
  expired: number;
  win_rate: number | null;
  avg_rr_achieved: number | null;
  cumulative_r: number;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/**
 * Recompute performance_daily rows from all signals.
 *   signals_generated : signals created on that day
 *   wins/losses/expired: signals RESOLVED that day by terminal status
 *   win_rate          : wins / (wins + losses) * 100 (decisive only; null if none)
 *   avg_rr_achieved   : mean R over signals resolved that day (incl. EXPIRED)
 *   cumulative_r      : running sum of R over all signals resolved up to & incl. that day
 * A day is emitted if it has any generation or any resolution.
 */
export function computePerformanceDaily(rows: RollupInput[]): PerformanceDay[] {
  const days = new Set<string>();
  for (const r of rows) {
    days.add(r.createdDate);
    if (r.resolvedDate) days.add(r.resolvedDate);
  }
  const sorted = [...days].sort();

  let running = 0;
  const out: PerformanceDay[] = [];
  for (const day of sorted) {
    const signals_generated = rows.filter((r) => r.createdDate === day).length;
    const resolvedThatDay = rows.filter((r) => r.resolvedDate === day);

    const wins = resolvedThatDay.filter((r) => r.status === 'HIT_TP').length;
    const losses = resolvedThatDay.filter((r) => r.status === 'HIT_SL').length;
    const expired = resolvedThatDay.filter((r) => r.status === 'EXPIRED').length;

    const decisive = wins + losses;
    const win_rate = decisive > 0 ? round2((wins / decisive) * 100) : null;

    const rValues = resolvedThatDay
      .map((r) => r.rMultiple)
      .filter((v): v is number => v != null);
    const avg_rr_achieved = rValues.length > 0 ? round2(mean(rValues)) : null;

    running += rValues.reduce((a, b) => a + b, 0);

    out.push({
      day,
      signals_generated,
      wins,
      losses,
      expired,
      win_rate,
      avg_rr_achieved,
      cumulative_r: round2(running),
    });
  }
  return out;
}

/**
 * Longest run of consecutive HIT_SL in resolution-time order. Pure & unit-tested
 * here; surfaced in INC-8 (not stored now).
 */
export function maxLosingStreak(statusesInResolutionOrder: SignalStatus[]): number {
  let max = 0;
  let cur = 0;
  for (const s of statusesInResolutionOrder) {
    if (s === 'HIT_SL') {
      cur += 1;
      if (cur > max) max = cur;
    } else {
      cur = 0;
    }
  }
  return max;
}
