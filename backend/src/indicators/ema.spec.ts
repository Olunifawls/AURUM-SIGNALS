import { emaSeries, emaLast } from './ema';

describe('EMA (SMA-seeded)', () => {
  it('(b) seeds the first EMA(period) value with the SMA of the first `period` closes, NOT the first close', () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
    const period = 10;
    const series = emaSeries(values, period);

    // warmup positions are null
    expect(series[period - 2]).toBeNull();
    // first EMA equals SMA of first 10 = (1+..+10)/10 = 5.5, and is NOT the first close (1)
    const sma10 = (1 + 2 + 3 + 4 + 5 + 6 + 7 + 8 + 9 + 10) / 10;
    expect(series[period - 1]).toBeCloseTo(sma10, 12);
    expect(series[period - 1]).toBe(5.5);
    expect(series[period - 1]).not.toBe(values[0]);
  });

  it('applies the EMA recursion after the seed (k = 2/(period+1))', () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]; // period 10 -> one recursion step
    const period = 10;
    const k = 2 / (period + 1);
    const seed = 5.5;
    const expected = 11 * k + seed * (1 - k);
    expect(emaLast(values, period)).toBeCloseTo(expected, 12);
  });

  it('returns a constant EMA for a constant series', () => {
    const values = new Array(50).fill(42);
    expect(emaLast(values, 20)).toBeCloseTo(42, 12);
  });

  it('emits nulls when there is not enough data', () => {
    expect(emaSeries([1, 2, 3], 10).every((v) => v === null)).toBe(true);
  });
});
