import { macdSeries, macdLast } from './macd';

describe('MACD(12,26,9) — fixed vectors', () => {
  it('is all zeros for a constant series (EMA_fast == EMA_slow == const)', () => {
    const closes = new Array(60).fill(100);
    const last = macdLast(closes);
    expect(last.macd).toBeCloseTo(0, 10);
    expect(last.signal).toBeCloseTo(0, 10);
    expect(last.histogram).toBeCloseTo(0, 10);
  });

  it('warms up correctly: macd starts at index 25, signal at index 33', () => {
    const closes = Array.from({ length: 60 }, (_, i) => 100 + i); // linear
    const series = macdSeries(closes);
    expect(series[24].macd).toBeNull();
    expect(series[25].macd).not.toBeNull(); // slow EMA(26) available at index 25
    expect(series[32].signal).toBeNull();
    expect(series[33].signal).not.toBeNull(); // signal EMA(9) over macd line -> 25 + 8
  });

  it('histogram equals macd minus signal', () => {
    const closes = Array.from({ length: 80 }, (_, i) => 100 + 5 * Math.sin(i / 4));
    const last = macdLast(closes);
    expect(last.histogram as number).toBeCloseTo((last.macd as number) - (last.signal as number), 10);
  });
});
