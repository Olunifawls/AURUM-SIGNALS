import { RiskEvent, SizingResult } from './risk.types';

export const ABSOLUTE_CEILING_PCT = 3.0;
export const TIER1_MAX_PCT = 2.0;
export const UNIT_STEP = 0.1; // OANDA XAU_USD tradeUnitsPrecision = 1 (0.1-unit steps)

/** Round DOWN to the 0.1-unit step (never up). */
export function floorToUnitStep(units: number): number {
  return Math.floor(units / UNIT_STEP + 1e-9) * UNIT_STEP;
}

export interface SizingInput {
  equity: number; // account ccy, FRESH from broker
  accountCcy: 'GBP' | 'USD';
  gbpUsdRate: number;
  riskPct: number; // requested (RISK_PER_TRADE_PCT)
  stopDistanceUsd: number; // |entry - stop|
  maxSlippagePoints: number;
  minTradeSize: number;
  tier2Unlocked: boolean;
  requestedEntry: number;
  stopLoss: number;
  takeProfit: number;
}

export interface SizingComputation {
  sizing: SizingResult;
  tierEvent?: RiskEvent;
}

/**
 * Sizing with the slippage buffer (D3/B2) and tier ceiling (D5/B4).
 * units = floor_0.1( risk_usd / (stop_distance_usd + slippage) ). Always down.
 * Tier 2 (>2.0%) without unlock -> clamp to 2.0% + TIER2_CLAMPED. 3.0% absolute cap.
 */
export function computeSizing(inp: SizingInput): SizingComputation {
  // Do NOT pre-cap at the ceiling here: the Tier-2 clamp handles the unlock rule,
  // and the absolute-ceiling BACKSTOP (exceedsAbsoluteCeiling) is the final guard
  // that rejects anything whose worst-case still exceeds 3.0%.
  let effectiveRiskPct = inp.riskPct;
  let clamped = false;
  let tierEvent: RiskEvent | undefined;

  if (effectiveRiskPct > TIER1_MAX_PCT && !inp.tier2Unlocked) {
    tierEvent = {
      event_type: 'TIER2_CLAMPED',
      severity: 'WARN',
      message: `requested risk ${inp.riskPct}% clamped to ${TIER1_MAX_PCT}% (Tier 2 not unlocked)`,
      meta: { requested: inp.riskPct, clampedTo: TIER1_MAX_PCT },
    };
    effectiveRiskPct = TIER1_MAX_PCT;
    clamped = true;
  }

  const riskCcy = inp.equity * (effectiveRiskPct / 100);
  const riskUsd = inp.accountCcy === 'GBP' ? riskCcy * inp.gbpUsdRate : riskCcy;

  const denom = inp.stopDistanceUsd + inp.maxSlippagePoints;
  const rawUnits = denom > 0 ? riskUsd / denom : 0;
  const units = floorToUnitStep(rawUnits);

  const worstCaseUsd = units * denom;
  const worstCaseCcy = inp.accountCcy === 'GBP' ? worstCaseUsd / inp.gbpUsdRate : worstCaseUsd;
  const worstCasePct = inp.equity > 0 ? (worstCaseCcy / inp.equity) * 100 : 0;

  return {
    sizing: {
      units,
      equityAtEntry: inp.equity,
      riskCcy: round2(riskCcy),
      riskUsd: round2(riskUsd),
      riskPctActual: round4(worstCasePct),
      worstCaseUsd: round2(worstCaseUsd),
      worstCasePct: round4(worstCasePct),
      effectiveRiskPct,
      clamped,
      requestedEntry: inp.requestedEntry,
      stopLoss: inp.stopLoss,
      takeProfit: inp.takeProfit,
    },
    tierEvent,
  };
}

/** Final backstop: reject if the order's worst-case risk exceeds the 3.0% ceiling. */
export function exceedsAbsoluteCeiling(worstCasePct: number): boolean {
  return worstCasePct > ABSOLUTE_CEILING_PCT + 1e-9;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
function round4(n: number): number {
  return Math.round((n + Number.EPSILON) * 10000) / 10000;
}
