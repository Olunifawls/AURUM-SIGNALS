import { computePathMetrics } from './path-metrics';
import { Candle15 } from '../tracker/resolution';

function candle(ts: string, open: number, high: number, low: number, close: number): Candle15 {
  return { ts, open, high, low, close };
}

// BUY: entry=2000, SL=1990 (risk=10). Levels: +0.5R=2005, +1R=2010, +1.5R=2015, +2R=2020.
describe('computePathMetrics — BUY', () => {
  const e = 2000, sl = 1990, tp = 2020;

  it('MFE and MAE from simple candle path', () => {
    const candles = [
      candle('t1', 2000, 2013, 1995, 2010), // high=13 fav, low=5 adv
      candle('t2', 2010, 2018, 2008, 2015),  // high=18 fav, low=8 adv — new MFE
    ];
    const m = computePathMetrics('BUY', e, sl, candles);
    expect(m.mfe_r).toBeCloseTo(1.8, 4);  // 18/10
    expect(m.mae_r).toBeCloseTo(0.5, 4);  // 5/10
    expect(m.candles_in_path).toBe(2);
  });

  it('R-crossing timestamps record first touch only', () => {
    const candles = [
      candle('t1', 2000, 2006, 1998, 2005),  // touches +0.5R (2005)
      candle('t2', 2005, 2011, 2003, 2009),  // touches +1R (2010)
      candle('t3', 2009, 2016, 2008, 2014),  // touches +1.5R (2015)
      candle('t4', 2014, 2022, 2013, 2020),  // touches +2R (2020)
    ];
    const m = computePathMetrics('BUY', e, sl, candles);
    expect(m.cross_0_5r_ts).toBe('t1');
    expect(m.cross_1r_ts).toBe('t2');
    expect(m.cross_1_5r_ts).toBe('t3');
    expect(m.cross_2r_ts).toBe('t4');
  });

  it('retraced_from_1_5r = false when +2R reached before +1R retrace', () => {
    // t1 low=2011 stays ABOVE +1R=2010 — no retrace on the 1.5R bar.
    const candles = [
      candle('t1', 2000, 2016, 2011, 2014),  // touches +1.5R, low stays above +1R
      candle('t2', 2014, 2021, 2013, 2018),  // touches +2R — no retrace to +1R first
    ];
    const m = computePathMetrics('BUY', e, sl, candles);
    expect(m.cross_1_5r_ts).toBe('t1');
    expect(m.cross_2r_ts).toBe('t2');
    expect(m.retraced_from_1_5r).toBe(false);
  });

  it('retraced_from_1_5r = true when +1R retrace before +2R (conservative same-bar)', () => {
    // Bar touches +1.5R (high=2016) AND low falls to +1R (low=2009 ≤ 2010).
    const candles = [
      candle('t1', 2000, 2016, 2009, 2012),
    ];
    const m = computePathMetrics('BUY', e, sl, candles);
    expect(m.cross_1_5r_ts).toBe('t1');
    expect(m.retraced_from_1_5r).toBe(true);
  });

  it('retraced_from_1_5r = null when +1.5R never reached', () => {
    const candles = [
      candle('t1', 2000, 2012, 1998, 2008),
    ];
    const m = computePathMetrics('BUY', e, sl, candles);
    expect(m.cross_1_5r_ts).toBeNull();
    expect(m.retraced_from_1_5r).toBeNull();
  });

  it('retraced_from_1_5r = false when signal expires between +1.5R and +2R', () => {
    const candles = [
      candle('t1', 2000, 2016, 2011, 2014),  // touches +1.5R, low stays above +1R
      candle('t2', 2014, 2018, 2012, 2016),  // never reaches +2R, never retraces to +1R
    ];
    const m = computePathMetrics('BUY', e, sl, candles);
    expect(m.cross_1_5r_ts).toBe('t1');
    expect(m.cross_2r_ts).toBeNull();
    expect(m.retraced_from_1_5r).toBe(false);
  });

  it('zero risk guard returns zeroed metrics', () => {
    const m = computePathMetrics('BUY', 2000, 2000, [candle('t1', 2000, 2010, 1995, 2005)]);
    expect(m.mfe_r).toBe(0);
    expect(m.mae_r).toBe(0);
  });

  it('ignores tp column — uses raw price levels', () => {
    // Explicitly confirm the tp param is not used in path-metrics (it computes from risk only).
    const m = computePathMetrics('BUY', e, sl, [candle('t1', 2000, 2020, 1998, 2018)]);
    expect(m.cross_2r_ts).toBe('t1');
    void tp; // tp is unused by design
  });
});

// SELL: entry=2000, SL=2010 (risk=10). Levels: +0.5R=1995, +1R=1990, +1.5R=1985, +2R=1980.
describe('computePathMetrics — SELL (symmetric)', () => {
  const e = 2000, sl = 2010;

  it('MFE (price down) and MAE (price up) for SELL', () => {
    const candles = [
      candle('t1', 2000, 2005, 1985, 1990),  // low=1985 → fav=15/10=1.5R, high=2005 → adv=5/10=0.5R
    ];
    const m = computePathMetrics('SELL', e, sl, candles);
    expect(m.mfe_r).toBeCloseTo(1.5, 4);
    expect(m.mae_r).toBeCloseTo(0.5, 4);
  });

  it('R-crossing timestamps for SELL (price falls)', () => {
    const candles = [
      candle('t1', 2000, 2001, 1994, 1996), // low=1994 → touches +0.5R (1995) but not +1R
      candle('t2', 1996, 1998, 1989, 1991), // low=1989 → touches +1R (1990)
    ];
    const m = computePathMetrics('SELL', e, sl, candles);
    expect(m.cross_0_5r_ts).toBe('t1');
    expect(m.cross_1r_ts).toBe('t2');
    expect(m.cross_1_5r_ts).toBeNull();
  });

  it('retraced_from_1_5r = true for SELL same-bar conservative', () => {
    // Bar: low=1984 (hits +1.5R=1985), high=1991 (rises back above +1R=1990 → retrace)
    const candles = [
      candle('t1', 2000, 1991, 1984, 1987),
    ];
    const m = computePathMetrics('SELL', e, sl, candles);
    expect(m.cross_1_5r_ts).toBe('t1');
    expect(m.retraced_from_1_5r).toBe(true);
  });
});
