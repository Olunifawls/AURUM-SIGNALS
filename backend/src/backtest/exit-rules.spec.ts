import { simulateExit } from './exit-rules';
import { Candle15 } from '../tracker/resolution';

function c(ts: string, open: number, high: number, low: number, close: number): Candle15 {
  return { ts, open, high, low, close };
}

// BUY: entry=2000, SL=1990 (risk=10). Levels: +1R=2010, +1.5R=2015, +2R=2020.
const E = 2000, SL = 1990, TP = 2020;

describe('BASELINE (A) — fixed 2:1, no BE', () => {
  it('exits at TP (+2R)', () => {
    const r = simulateExit('BASELINE', 'BUY', E, SL, TP, [c('t1', 2000, 2021, 2002, 2018)]);
    expect(r.rMultiple).toBe(2);
    expect(r.exitReason).toBe('TP');
  });

  it('exits at SL (−1R), conservative wins when same bar hits both', () => {
    // Same bar touches SL (low=1989) AND TP (high=2021): conservative → SL.
    const r = simulateExit('BASELINE', 'BUY', E, SL, TP, [c('t1', 2000, 2021, 1989, 2010)]);
    expect(r.rMultiple).toBe(-1);
    expect(r.exitReason).toBe('SL');
  });

  it('expires at last close when neither SL nor TP hit', () => {
    const r = simulateExit('BASELINE', 'BUY', E, SL, TP, [
      c('t1', 2000, 2005, 1998, 2003),
      c('t2', 2003, 2008, 2001, 2006),
    ]);
    expect(r.exitReason).toBe('EXPIRED');
    expect(r.rMultiple).toBeCloseTo(0.6, 2); // (2006 - 2000) / 10
  });
});

describe('CURRENT (B) — breakeven at +1R', () => {
  it('BE triggered, then stopped at entry (0R) when price reverses', () => {
    const candles = [
      c('t1', 2000, 2011, 2003, 2009), // triggers BE (high=2011 ≥ 2010)
      c('t2', 2009, 2012, 1999, 2001), // low=1999 ≤ 2000 (BE stop)
    ];
    const r = simulateExit('CURRENT', 'BUY', E, SL, TP, candles);
    expect(r.rMultiple).toBe(0);
    expect(r.exitReason).toBe('BE_STOP');
  });

  it('normal SL hit before BE triggers gives −1R', () => {
    const r = simulateExit('CURRENT', 'BUY', E, SL, TP, [c('t1', 2000, 2005, 1988, 2002)]);
    expect(r.rMultiple).toBe(-1);
    expect(r.exitReason).toBe('SL');
  });

  it('TP hit after BE gives +2R', () => {
    const candles = [
      c('t1', 2000, 2011, 2001, 2009), // BE trigger
      c('t2', 2009, 2021, 2005, 2018), // TP
    ];
    const r = simulateExit('CURRENT', 'BUY', E, SL, TP, candles);
    expect(r.rMultiple).toBe(2);
    expect(r.exitReason).toBe('TP');
  });
});

describe('RATCHET (C) — BE at +1R, stop moves to +1R at +1.5R', () => {
  it('ratchet triggered, then stopped at +1R gives 1R', () => {
    const candles = [
      c('t1', 2000, 2011, 2001, 2009), // BE
      c('t2', 2009, 2016, 2005, 2014), // ratchet (high ≥ 2015)
      c('t3', 2014, 2013, 2009, 2011), // low=2009 ≤ 2010 (ratchet stop at +1R)
    ];
    const r = simulateExit('RATCHET', 'BUY', E, SL, TP, candles);
    expect(r.rMultiple).toBe(1);
    expect(r.exitReason).toBe('RATCHET_STOP');
  });

  it('BE triggered then stopped at 0R if ratchet never fires', () => {
    const candles = [
      c('t1', 2000, 2011, 2001, 2009), // BE
      c('t2', 2009, 2013, 1999, 2005), // low ≤ 2000 (BE stop, ratchet never fired)
    ];
    const r = simulateExit('RATCHET', 'BUY', E, SL, TP, candles);
    expect(r.rMultiple).toBe(0);
    expect(r.exitReason).toBe('BE_STOP');
  });

  it('TP hit gives +2R regardless of ratchet state', () => {
    const candles = [
      c('t1', 2000, 2011, 2001, 2009),
      c('t2', 2009, 2016, 2005, 2014),
      c('t3', 2014, 2021, 2012, 2019),
    ];
    const r = simulateExit('RATCHET', 'BUY', E, SL, TP, candles);
    expect(r.rMultiple).toBe(2);
    expect(r.exitReason).toBe('TP');
  });
});

describe('PARTIAL (D) — 50% at +1R, 50% to 2R with BE stop', () => {
  it('partial at +1R, remaining hits TP: total 1.5R', () => {
    const candles = [
      c('t1', 2000, 2011, 2001, 2009), // partial at +1R
      c('t2', 2009, 2021, 2007, 2018), // remaining hits TP
    ];
    const r = simulateExit('PARTIAL', 'BUY', E, SL, TP, candles);
    expect(r.rMultiple).toBe(1.5);
    expect(r.exitReason).toBe('TP');
  });

  it('partial at +1R, remaining hits BE: total 0.5R', () => {
    const candles = [
      c('t1', 2000, 2011, 2001, 2009), // partial at +1R
      c('t2', 2009, 2012, 1999, 2002), // low ≤ 2000 → BE stop for remaining
    ];
    const r = simulateExit('PARTIAL', 'BUY', E, SL, TP, candles);
    expect(r.rMultiple).toBe(0.5);
    expect(r.exitReason).toBe('BE_STOP');
  });

  it('full SL hit before +1R: −1R', () => {
    const r = simulateExit('PARTIAL', 'BUY', E, SL, TP, [c('t1', 2000, 2005, 1988, 2001)]);
    expect(r.rMultiple).toBe(-1);
    expect(r.exitReason).toBe('SL');
  });

  it('TP hit before +1R trigger: full +2R (no partial split)', () => {
    const r = simulateExit('PARTIAL', 'BUY', E, SL, TP, [c('t1', 2000, 2021, 1995, 2015)]);
    expect(r.rMultiple).toBe(2);
    expect(r.exitReason).toBe('TP');
  });
});

describe('REVERSAL_EXIT (E) — exit on first bearish close after +1.5R', () => {
  it('exits on first bearish close after reaching +1.5R', () => {
    const candles = [
      c('t1', 2000, 2016, 2005, 2014), // reaches +1.5R → monitoring on
      c('t2', 2014, 2018, 2013, 2013), // bullish? close=2013 < open=2014 → bearish → exit
    ];
    const r = simulateExit('REVERSAL_EXIT', 'BUY', E, SL, TP, candles);
    expect(r.exitReason).toBe('REVERSAL_CLOSE');
    expect(r.rMultiple).toBeCloseTo((2013 - 2000) / 10, 2); // 1.3R
  });

  it('TP hit takes priority over reversal close', () => {
    const candles = [
      c('t1', 2000, 2016, 2005, 2014), // monitoring on
      c('t2', 2014, 2021, 2013, 2011), // high hits TP (2021 ≥ 2020) before bearish close
    ];
    const r = simulateExit('REVERSAL_EXIT', 'BUY', E, SL, TP, candles);
    expect(r.exitReason).toBe('TP');
    expect(r.rMultiple).toBe(2);
  });

  it('SL hit before +1.5R gives −1R (same as BASELINE pre-monitoring)', () => {
    const r = simulateExit('REVERSAL_EXIT', 'BUY', E, SL, TP, [c('t1', 2000, 2008, 1988, 2003)]);
    expect(r.rMultiple).toBe(-1);
    expect(r.exitReason).toBe('SL');
  });

  it('bullish closes after +1.5R do not trigger exit; then TP reached', () => {
    const candles = [
      c('t1', 2000, 2016, 2005, 2015),  // monitoring on, candle is bullish (15 > 00? open=2000→close=2015 = bull)
      c('t2', 2015, 2019, 2013, 2017),  // bullish (close > open) — no exit
      c('t3', 2017, 2022, 2015, 2019),  // TP hit
    ];
    const r = simulateExit('REVERSAL_EXIT', 'BUY', E, SL, TP, candles);
    expect(r.exitReason).toBe('TP');
  });
});

describe('SELL symmetry', () => {
  // SELL entry=2000, SL=2010, TP=1980, risk=10.
  it('BASELINE SELL: TP hit', () => {
    const r = simulateExit('BASELINE', 'SELL', 2000, 2010, 1980, [c('t1', 2000, 2005, 1978, 1990)]);
    expect(r.rMultiple).toBe(2);
    expect(r.exitReason).toBe('TP');
  });

  it('CURRENT SELL: BE stop at 0R', () => {
    const candles = [
      c('t1', 2000, 2005, 1989, 1993), // low=1989 ≤ 1990 → BE triggered
      c('t2', 1993, 2001, 1988, 1995), // high=2001 ≥ 2000 (entry) → BE stop
    ];
    const r = simulateExit('CURRENT', 'SELL', 2000, 2010, 1980, candles);
    expect(r.rMultiple).toBe(0);
    expect(r.exitReason).toBe('BE_STOP');
  });
});
