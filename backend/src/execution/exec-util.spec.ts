import { achievedRr, actualRiskPctAtFill, inferCloseReason, isTimeStopped, realizedR, slippagePoints } from './exec-util';

describe('execution helpers', () => {
  it('slippagePoints', () => {
    expect(slippagePoints(2001.2, 2000)).toBeCloseTo(1.2, 6);
  });

  it('achievedRr from the actual fill', () => {
    expect(achievedRr(2000, 1990, 2020)).toBeCloseTo(2, 6);
    expect(achievedRr(2002, 1990, 2020)).toBeCloseTo(18 / 12, 6); // fill worse -> lower RR
  });

  it('realizedR (price-based, both sides)', () => {
    expect(realizedR(2000, 1990, 2020, 'BUY')).toBeCloseTo(2, 6);
    expect(realizedR(2000, 2010, 1980, 'SELL')).toBeCloseTo(2, 6);
    expect(realizedR(2000, 1990, 1990, 'BUY')).toBeCloseTo(-1, 6);
  });

  it('inferCloseReason', () => {
    expect(inferCloseReason(2020, 1990, 2020)).toBe('TP_HIT');
    expect(inferCloseReason(1990, 1990, 2020)).toBe('SL_HIT');
    expect(inferCloseReason(2005, 1990, 2020)).toBe('CLOSED_AT_BROKER');
  });

  it('(f) isTimeStopped after > 5 trading days', () => {
    const now = new Date('2024-01-12T12:00:00Z'); // Friday
    expect(isTimeStopped('2024-01-01T12:00:00Z', now)).toBe(true); // ~8 trading days
    expect(isTimeStopped('2024-01-09T12:00:00Z', now)).toBe(false); // ~3 trading days
  });

  it('actualRiskPctAtFill scales with the slipped stop distance', () => {
    expect(actualRiskPctAtFill(1.0, 2000, 1990, 2000)).toBeCloseTo(1.0, 6);
    expect(actualRiskPctAtFill(1.0, 2000, 1990, 2001)).toBeCloseTo(1.1, 6); // fill 1 further from stop
  });
});

// R must always use the ORIGINAL stop at entry, never the current (possibly
// breakeven-moved) stop. The three cases that prove the invariant:
describe('realizedR — original stop invariant (breakeven-moved positions)', () => {
  // BUY entry=4100, originalSL=4080 (risk=20), BE stop moved to 4100.1.

  it('(i) breakeven-moved trade hitting TP reports +2R, not inflated hundreds', () => {
    // Closing at 4140 (TP, +40 points = 2× original risk of 20).
    // With breakevenSL=4100.1: risk=0.1 → R=400 (the old bug).
    const originalSL = 4080;
    expect(realizedR(4100, originalSL, 4140, 'BUY')).toBeCloseTo(2.0, 4);
  });

  it('(ii) breakeven-moved trade closing near entry reports small R, not inflated', () => {
    // Closing at 4101 (+1 point above entry = 0.05R against original 20-point risk).
    // With breakevenSL=4100.1: risk=0.1 → R=+10 (wrong).
    // With originalSL=4080: R=1/20=0.05R.
    const originalSL = 4080;
    expect(realizedR(4100, originalSL, 4101, 'BUY')).toBeCloseTo(0.05, 2);
  });

  it('(iii) normal stop-out (no breakeven move) reports −1R', () => {
    // Stop was never moved; original and current stop are identical.
    const originalSL = 4080;
    expect(realizedR(4100, originalSL, 4080, 'BUY')).toBeCloseTo(-1.0, 4);
  });
});
