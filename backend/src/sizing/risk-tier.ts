/** Absolute hard ceiling (RISK_CEILING_PCT). No path may exceed this. */
export const RISK_CEILING_PCT = 3.0;

export const TIER1_MIN = 0.5;
export const TIER1_MAX = 2.0;
export const TIER2_MAX = 3.0;

export const TIER2_UNLOCK_RESOLVED = 50;
export const ACK_STRING = 'I ACCEPT THE DRAWDOWN RISK';

export interface TierGate {
  resolvedCount: number;
  cumulativeR: number;
}

export function tier2Unlocked(gate: TierGate): boolean {
  return gate.resolvedCount >= TIER2_UNLOCK_RESOLVED && gate.cumulativeR > 0;
}

export interface RiskValidation {
  ok: boolean;
  tier: 1 | 2 | null;
  requiresAck: boolean;
  reason?: string;
}

/**
 * Validate a requested risk_pct against the tier rules. Order:
 *   > 3.0            -> rejected unconditionally (hard ceiling)
 *   < 0.5            -> rejected (below Tier 1 floor)
 *   0.5 .. 2.0       -> Tier 1, freely allowed
 *   > 2.0 .. 3.0     -> Tier 2: locked until >=50 resolved AND cumulative R > 0;
 *                       once unlocked, requires the exact acknowledgment string
 */
export function validateRiskPct(
  requested: number,
  gate: TierGate,
  acknowledgment?: string,
): RiskValidation {
  if (!Number.isFinite(requested)) {
    return { ok: false, tier: null, requiresAck: false, reason: 'risk_pct must be a number' };
  }
  if (requested > RISK_CEILING_PCT) {
    return {
      ok: false,
      tier: null,
      requiresAck: false,
      reason: `risk_pct ${requested}% exceeds the absolute hard ceiling of ${RISK_CEILING_PCT}% and is rejected unconditionally`,
    };
  }
  if (requested < TIER1_MIN) {
    return {
      ok: false,
      tier: null,
      requiresAck: false,
      reason: `risk_pct ${requested}% is below the Tier 1 minimum of ${TIER1_MIN}%`,
    };
  }
  if (requested <= TIER1_MAX) {
    return { ok: true, tier: 1, requiresAck: false };
  }

  // Tier 2 (ELEVATED): anything above 2.0 up to the 3.0 ceiling.
  if (!tier2Unlocked(gate)) {
    return {
      ok: false,
      tier: 2,
      requiresAck: true,
      reason: `Tier 2 (ELEVATED, >${TIER1_MAX}–${TIER2_MAX}%) is LOCKED: requires >= ${TIER2_UNLOCK_RESOLVED} resolved signals AND cumulative R > 0 (currently ${gate.resolvedCount} resolved, cumulative R ${gate.cumulativeR})`,
    };
  }
  if (acknowledgment !== ACK_STRING) {
    return {
      ok: false,
      tier: 2,
      requiresAck: true,
      reason: `Tier 2 requires the exact typed acknowledgment "${ACK_STRING}"`,
    };
  }
  return { ok: true, tier: 2, requiresAck: true };
}
