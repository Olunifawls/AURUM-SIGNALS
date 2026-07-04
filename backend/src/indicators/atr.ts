/**
 * True Range series. tr[0] = high[0] - low[0]; for i >= 1:
 *   tr[i] = max(high-low, |high - prevClose|, |low - prevClose|).
 */
export function trueRanges(highs: number[], lows: number[], closes: number[]): number[] {
  const n = highs.length;
  const tr: number[] = new Array(n);
  for (let i = 0; i < n; i++) {
    if (i === 0) {
      tr[i] = highs[0] - lows[0];
    } else {
      const hl = highs[i] - lows[i];
      const hc = Math.abs(highs[i] - closes[i - 1]);
      const lc = Math.abs(lows[i] - closes[i - 1]);
      tr[i] = Math.max(hl, hc, lc);
    }
  }
  return tr;
}

/**
 * Average True Range using Wilder's smoothing.
 * First ATR (index period-1) = mean of the first `period` true ranges, then
 * atr[i] = (atr[i-1] * (period - 1) + tr[i]) / period.
 */
export function atrSeries(
  highs: number[],
  lows: number[],
  closes: number[],
  period = 14,
): (number | null)[] {
  const tr = trueRanges(highs, lows, closes);
  const n = tr.length;
  const out: (number | null)[] = new Array(n).fill(null);
  if (n < period) return out;

  let sum = 0;
  for (let i = 0; i < period; i++) sum += tr[i];
  let atr = sum / period;
  out[period - 1] = atr;

  for (let i = period; i < n; i++) {
    atr = (atr * (period - 1) + tr[i]) / period;
    out[i] = atr;
  }
  return out;
}

export function atrLast(
  highs: number[],
  lows: number[],
  closes: number[],
  period = 14,
): number | null {
  const series = atrSeries(highs, lows, closes, period);
  return series.length ? series[series.length - 1] : null;
}
