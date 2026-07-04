import { trueRanges, atrSeries, atrLast } from './atr';

describe('ATR Wilder — fixed vector', () => {
  // Hand-worked 5-candle example, period = 3.
  //  i: high  low  close
  //  0:  10    8    9      tr0 = high-low          = 2
  //  1:  11    9    10     tr1 = max(2, 2, 0)      = 2
  //  2:  12    10   11     tr2 = max(2, 2, 0)      = 2
  //  3:  11    9    9.5    tr3 = max(2, 0, 2)      = 2
  //  4:  13    10   12     tr4 = max(3, 3.5, 0.5)  = 3.5
  const highs = [10, 11, 12, 11, 13];
  const lows = [8, 9, 10, 9, 10];
  const closes = [9, 10, 11, 9.5, 12];

  it('computes true ranges correctly (tr[0] = high-low)', () => {
    expect(trueRanges(highs, lows, closes)).toEqual([2, 2, 2, 2, 3.5]);
  });

  it('(a-i) seeds ATR with the SMA of the first `period` TRs, then Wilder-smooths', () => {
    // seed atr[2] = mean(2,2,2) = 2
    // atr[3] = (2*2 + 2)/3 = 2
    // atr[4] = (2*2 + 3.5)/3 = 2.5
    const series = atrSeries(highs, lows, closes, 3);
    expect(series[0]).toBeNull();
    expect(series[1]).toBeNull();
    expect(series[2]).toBeCloseTo(2, 12);
    expect(series[3]).toBeCloseTo(2, 12);
    expect(series[4]).toBeCloseTo(2.5, 12);
    expect(atrLast(highs, lows, closes, 3)).toBeCloseTo(2.5, 12);
  });
});
