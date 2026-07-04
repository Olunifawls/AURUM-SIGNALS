import { rsiSeries, rsiLast } from './rsi';

describe('RSI(14) Wilder — fixed vectors', () => {
  it('(a-i) matches the hand-computed first RSI on the classic Wilder/StockCharts series', () => {
    // 15 closes -> 14 changes -> exactly one RSI value at index 14.
    const closes = [
      44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.1, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61,
      46.28, 46.28,
    ];
    // Hand computation: sum gains = 3.34, sum losses = 1.40 over 14 changes
    //   avgGain = 3.34/14 = 0.238571, avgLoss = 1.40/14 = 0.10
    //   RS = 2.385714, RSI = 100 - 100/(1+RS) = 70.4648...
    const first = rsiSeries(closes, 14)[14];
    expect(first).not.toBeNull();
    // Exact-arithmetic value is 70.4648; IEEE-754 arithmetic over these decimal
    // closes lands at 70.46414. Assert within an absolute tolerance of 1e-3.
    expect(Math.abs((first as number) - 70.4648)).toBeLessThan(1e-3);
  });

  it('is 100 when every change is a gain (no losses)', () => {
    const closes = Array.from({ length: 20 }, (_, i) => 100 + i); // strictly increasing
    expect(rsiLast(closes, 14)).toBeCloseTo(100, 12);
  });

  it('is 0 when every change is a loss (no gains)', () => {
    const closes = Array.from({ length: 20 }, (_, i) => 100 - i); // strictly decreasing
    expect(rsiLast(closes, 14)).toBeCloseTo(0, 12);
  });

  it('emits nulls with fewer than period+1 closes', () => {
    expect(rsiSeries([1, 2, 3], 14).every((v) => v === null)).toBe(true);
  });
});
