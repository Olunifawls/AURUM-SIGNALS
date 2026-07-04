import { emaSeries } from './ema';

export interface MacdPoint {
  macd: number | null;
  signal: number | null;
  histogram: number | null;
}

/**
 * MACD(12, 26, 9):
 *   macd line = EMA(fast) - EMA(slow)   (both SMA-seeded EMAs)
 *   signal    = EMA(signalPeriod) of the macd line (SMA-seeded)
 *   histogram = macd - signal
 */
export function macdSeries(
  closes: number[],
  fast = 12,
  slow = 26,
  signalPeriod = 9,
): MacdPoint[] {
  const n = closes.length;
  const out: MacdPoint[] = closes.map(() => ({ macd: null, signal: null, histogram: null }));

  const emaFast = emaSeries(closes, fast);
  const emaSlow = emaSeries(closes, slow);

  const macdLine: (number | null)[] = new Array(n).fill(null);
  let firstIdx = -1;
  for (let i = 0; i < n; i++) {
    if (emaFast[i] != null && emaSlow[i] != null) {
      macdLine[i] = (emaFast[i] as number) - (emaSlow[i] as number);
      if (firstIdx === -1) firstIdx = i;
    }
  }
  if (firstIdx === -1) return out;

  // Compact the macd line (drop warmup nulls) so the signal EMA is SMA-seeded
  // over the first `signalPeriod` real macd values.
  const compact: number[] = [];
  for (let i = firstIdx; i < n; i++) compact.push(macdLine[i] as number);
  const signal = emaSeries(compact, signalPeriod);

  for (let j = 0; j < compact.length; j++) {
    const i = firstIdx + j;
    out[i].macd = macdLine[i];
    out[i].signal = signal[j];
    out[i].histogram = signal[j] != null ? (macdLine[i] as number) - (signal[j] as number) : null;
  }
  return out;
}

export function macdLast(
  closes: number[],
  fast = 12,
  slow = 26,
  signalPeriod = 9,
): MacdPoint {
  const series = macdSeries(closes, fast, slow, signalPeriod);
  return series.length ? series[series.length - 1] : { macd: null, signal: null, histogram: null };
}
