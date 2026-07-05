import { computeSizing, exceedsAbsoluteCeiling, floorToUnitStep } from './sizing';

const base = {
  equity: 2000,
  accountCcy: 'GBP' as const,
  gbpUsdRate: 1.25,
  minTradeSize: 0.1,
  requestedEntry: 2000,
  stopLoss: 1991.6,
  takeProfit: 2016.8,
};

describe('(c) sizing worked example (0.1 precision + slippage buffer, GBP/USD=1.25)', () => {
  it('equity £2000, risk 1%, stop $8.40, slippage 0.50 -> units 2.8, worst-case $24.92 <= $25', () => {
    const { sizing } = computeSizing({ ...base, riskPct: 1, stopDistanceUsd: 8.4, maxSlippagePoints: 0.5, tier2Unlocked: false });
    expect(sizing.riskCcy).toBeCloseTo(20, 6); // £20
    expect(sizing.riskUsd).toBeCloseTo(25, 6); // $25
    expect(sizing.units).toBeCloseTo(2.8, 6); // round DOWN of 25/8.90 = 2.808
    expect(sizing.worstCaseUsd).toBeCloseTo(24.92, 2); // 2.8 * 8.90 <= 25 budget
    expect(sizing.worstCaseUsd).toBeLessThanOrEqual(25);
  });

  it('always rounds units DOWN to 0.1 (0.29 -> 0.2)', () => {
    expect(floorToUnitStep(0.29)).toBeCloseTo(0.2, 6);
    expect(floorToUnitStep(2.808)).toBeCloseTo(2.8, 6);
  });
});

describe('(d) tier ceiling', () => {
  it('risk 2.5% with no unlock -> clamped to 2.0% + TIER2_CLAMPED event', () => {
    const { sizing, tierEvent } = computeSizing({ ...base, riskPct: 2.5, stopDistanceUsd: 10, maxSlippagePoints: 0.5, tier2Unlocked: false });
    expect(sizing.effectiveRiskPct).toBe(2.0);
    expect(sizing.clamped).toBe(true);
    expect(tierEvent?.event_type).toBe('TIER2_CLAMPED');
  });

  it('unlocked Tier 2 at a mis-set 3.5% risk -> worst-case exceeds the 3.0% backstop', () => {
    const { sizing } = computeSizing({ ...base, riskPct: 3.5, stopDistanceUsd: 10, maxSlippagePoints: 0.5, tier2Unlocked: true });
    expect(sizing.effectiveRiskPct).toBe(3.5); // not clamped (unlocked)
    expect(sizing.worstCasePct).toBeGreaterThan(3.0);
    expect(exceedsAbsoluteCeiling(sizing.worstCasePct)).toBe(true);
  });

  it('a normal 1% order does NOT trip the backstop', () => {
    const { sizing } = computeSizing({ ...base, riskPct: 1, stopDistanceUsd: 8.4, maxSlippagePoints: 0.5, tier2Unlocked: false });
    expect(exceedsAbsoluteCeiling(sizing.worstCasePct)).toBe(false);
  });
});

describe('(e) too-small position', () => {
  it('a very wide stop yields units < 0.1 (caller must block, not tighten the stop)', () => {
    const { sizing } = computeSizing({ equity: 100, accountCcy: 'GBP', gbpUsdRate: 1.25, riskPct: 1, stopDistanceUsd: 500, maxSlippagePoints: 0.5, minTradeSize: 0.1, tier2Unlocked: false, requestedEntry: 2000, stopLoss: 1500, takeProfit: 3000 });
    expect(sizing.units).toBeLessThan(0.1);
    expect(sizing.stopLoss).toBe(1500); // stop is UNCHANGED
  });
});
