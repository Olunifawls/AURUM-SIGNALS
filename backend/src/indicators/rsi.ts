/**
 * Relative Strength Index using Wilder's smoothing.
 *
 * First average gain/loss = simple mean of the first `period` gains/losses,
 * then Wilder's smoothing: avg = (prevAvg * (period - 1) + current) / period.
 * The first RSI value appears at index `period` (needs period + 1 closes).
 */
function rsiFromAverages(avgGain: number, avgLoss: number): number {
  if (avgLoss === 0) return avgGain === 0 ? 50 : 100; // no losses -> maxed (neutral if flat)
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

export function rsiSeries(closes: number[], period = 14): (number | null)[] {
  const n = closes.length;
  const out: (number | null)[] = new Array(n).fill(null);
  if (n < period + 1) return out;

  const gains: number[] = [];
  const losses: number[] = [];
  for (let i = 1; i < n; i++) {
    const d = closes[i] - closes[i - 1];
    gains.push(Math.max(d, 0)); // gains[k] corresponds to closes[k + 1]
    losses.push(Math.max(-d, 0));
  }

  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 0; i < period; i++) {
    avgGain += gains[i];
    avgLoss += losses[i];
  }
  avgGain /= period;
  avgLoss /= period;
  out[period] = rsiFromAverages(avgGain, avgLoss);

  for (let i = period; i < gains.length; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]) / period;
    avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
    out[i + 1] = rsiFromAverages(avgGain, avgLoss);
  }
  return out;
}

export function rsiLast(closes: number[], period = 14): number | null {
  const series = rsiSeries(closes, period);
  return series.length ? series[series.length - 1] : null;
}
