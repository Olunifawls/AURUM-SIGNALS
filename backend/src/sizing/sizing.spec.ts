import { computeSizing, floorToLotStep } from './sizing';

describe('(a) worked example (GBP/USD = 1.25)', () => {
  // account £2000, risk 1%, stop distance $8.40 -> 0.02 lots, ~$16.80 / £13.44
  const r = computeSizing({
    accountSize: 2000,
    accountCcy: 'GBP',
    riskPct: 1,
    entry: 2000,
    stop: 2008.4, // |entry-stop| = 8.40
    gbpUsdRate: 1.25,
  });

  it('suggested_lots = 0.02 (raw 0.0298 rounded DOWN)', () => {
    expect(r.rawLots).toBeCloseTo(25 / 840, 6); // 0.029762
    expect(r.suggestedLots).toBe(0.02);
  });

  it('risk ≈ $16.80 / £13.44 at the rounded lot', () => {
    const riskUsd = r.suggestedLots * 100 * r.stopDistanceUsd;
    expect(riskUsd).toBeCloseTo(16.8, 6);
    expect(r.riskAmountCcy).toBeCloseTo(13.44, 6);
  });

  it('reward at default 2:1 is double the risk', () => {
    expect(r.rewardAmountCcy).toBeCloseTo(26.88, 6);
  });

  it('note reads naturally', () => {
    expect(r.sizingNote).toBe('Your size: 0.02 lots (risking ~£13.44 ≈ 0.67% of account)');
  });
});

describe('(b) round DOWN and TOO SMALL', () => {
  it('floorToLotStep always rounds down (0.029 -> 0.02, never 0.03)', () => {
    expect(floorToLotStep(0.029)).toBe(0.02);
    expect(floorToLotStep(0.0299999)).toBe(0.02);
    expect(floorToLotStep(0.02)).toBe(0.02); // exact value not pushed to 0.01
    expect(floorToLotStep(0.3006)).toBe(0.3);
  });

  it('a position that rounds to 0.00 flags TOO SMALL and does not alter the stop', () => {
    // Tiny account, wide stop -> raw well below 0.01.
    const r = computeSizing({
      accountSize: 100,
      accountCcy: 'GBP',
      riskPct: 1,
      entry: 2000,
      stop: 2050, // $50 stop distance
      gbpUsdRate: 1.25,
    });
    expect(r.suggestedLots).toBe(0);
    expect(r.tooSmall).toBe(true);
    expect(r.sizingNote).toContain('POSITION TOO SMALL');
    expect(r.sizingNote).toContain('Do not force this trade');
    // stop input is untouched by the sizing function (it only reads it)
    expect(r.stopDistanceUsd).toBe(50);
  });
});
