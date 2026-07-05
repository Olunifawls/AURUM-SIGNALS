import { validateRiskPct, tier2Unlocked, ACK_STRING, TierGate } from './risk-tier';

const locked: TierGate = { resolvedCount: 10, cumulativeR: 5 }; // < 50 resolved
const unlocked: TierGate = { resolvedCount: 50, cumulativeR: 3.5 };

describe('tier2Unlocked', () => {
  it('requires >= 50 resolved AND cumulative R > 0', () => {
    expect(tier2Unlocked({ resolvedCount: 49, cumulativeR: 5 })).toBe(false);
    expect(tier2Unlocked({ resolvedCount: 50, cumulativeR: 0 })).toBe(false);
    expect(tier2Unlocked({ resolvedCount: 50, cumulativeR: 0.1 })).toBe(true);
  });
});

describe('validateRiskPct', () => {
  it('rejects > 3.0 unconditionally (hard ceiling), even when unlocked', () => {
    const v = validateRiskPct(3.5, unlocked, ACK_STRING);
    expect(v.ok).toBe(false);
    expect(v.reason).toContain('hard ceiling');
  });

  it('allows Tier 1 (0.5–2.0) freely', () => {
    expect(validateRiskPct(0.5, locked)).toMatchObject({ ok: true, tier: 1 });
    expect(validateRiskPct(1.5, locked)).toMatchObject({ ok: true, tier: 1 });
    expect(validateRiskPct(2.0, locked)).toMatchObject({ ok: true, tier: 1 });
  });

  it('rejects below the Tier 1 floor (0.5%)', () => {
    expect(validateRiskPct(0.3, locked).ok).toBe(false);
  });

  it('rejects Tier 2 (2.1–3.0) while LOCKED', () => {
    const v = validateRiskPct(2.5, locked);
    expect(v.ok).toBe(false);
    expect(v.tier).toBe(2);
    expect(v.reason).toContain('LOCKED');
  });

  it('rejects Tier 2 when unlocked but WITHOUT the exact acknowledgment', () => {
    expect(validateRiskPct(2.5, unlocked).ok).toBe(false);
    expect(validateRiskPct(2.5, unlocked, 'i accept the drawdown risk').ok).toBe(false);
    expect(validateRiskPct(2.5, unlocked, 'yes').reason).toContain('acknowledgment');
  });

  it('accepts Tier 2 when unlocked WITH the exact acknowledgment', () => {
    const v = validateRiskPct(2.5, unlocked, ACK_STRING);
    expect(v).toMatchObject({ ok: true, tier: 2, requiresAck: true });
  });

  it('treats the 3.0 ceiling value itself as Tier 2 (needs unlock + ack)', () => {
    expect(validateRiskPct(3.0, locked).ok).toBe(false);
    expect(validateRiskPct(3.0, unlocked, ACK_STRING).ok).toBe(true);
  });
});
