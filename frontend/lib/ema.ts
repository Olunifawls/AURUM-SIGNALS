// Client-side EMA for the chart overlay ONLY (display). Same SMA-seeded
// definition as the backend indicator engine, so the drawn lines match.
export function emaSeries(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (values.length < period) return out;
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
