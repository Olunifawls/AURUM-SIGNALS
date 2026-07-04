/**
 * Exponential Moving Average, SEEDED with the SMA of the first `period` values
 * (per spec D9): out[period-1] = mean(values[0..period-1]), then the standard
 * EMA recursion. Warmup positions (0..period-2) are null.
 *
 * Multiplier k = 2 / (period + 1).
 */
export function emaSeries(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (period <= 0 || values.length < period) return out;

  const k = 2 / (period + 1);

  let sma = 0;
  for (let i = 0; i < period; i++) sma += values[i];
  sma /= period;

  out[period - 1] = sma;
  let prev = sma;
  for (let i = period; i < values.length; i++) {
    const e = values[i] * k + prev * (1 - k);
    out[i] = e;
    prev = e;
  }
  return out;
}

/** Convenience: the last (most recent) EMA value, or null if not enough data. */
export function emaLast(values: number[], period: number): number | null {
  const series = emaSeries(values, period);
  return series.length ? series[series.length - 1] : null;
}
