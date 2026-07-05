/**
 * Gold lot mechanics: 1.00 lot XAU/USD = 100 oz, so a $1.00 price move = $100
 * per lot. All sizing rounds lots DOWN to 0.01 granularity — never up.
 */
export const LOT_OZ = 100;

export interface SizingInputs {
  accountSize: number;
  accountCcy: string; // e.g. 'GBP'
  riskPct: number;
  entry: number;
  stop: number;
  takeProfit?: number; // default = 2:1 from entry/stop
  gbpUsdRate: number; // latest fx_rates GBP/USD
}

export interface SizingResult {
  stopDistanceUsd: number;
  rawLots: number;
  suggestedLots: number; // floored to 0.01, >= 0
  riskAmountCcy: number; // actual account-ccy risk at the rounded lot
  rewardAmountCcy: number; // account-ccy reward at target
  tooSmall: boolean;
  sizingNote: string;
}

/** Round DOWN to 0.01 granularity (never up). Small epsilon guards float noise
 * on values that are exactly representable, without ever bumping up a rounded-down value. */
export function floorToLotStep(lots: number): number {
  return Math.floor(lots * 100 + 1e-9) / 100;
}

function ccySymbol(ccy: string): string {
  return ccy === 'GBP' ? '£' : `${ccy} `;
}

export function computeSizing(inp: SizingInputs): SizingResult {
  const sym = ccySymbol(inp.accountCcy);
  const stopDistanceUsd = Math.abs(inp.entry - inp.stop);

  const riskBudgetCcy = inp.accountSize * (inp.riskPct / 100);
  const riskBudgetUsd = riskBudgetCcy * inp.gbpUsdRate;

  const rawLots = stopDistanceUsd > 0 ? riskBudgetUsd / (stopDistanceUsd * LOT_OZ) : 0;
  const suggestedLots = floorToLotStep(rawLots);
  const tooSmall = suggestedLots <= 0;

  // Actual risk/reward at the ROUNDED lot size.
  const riskUsd = suggestedLots * LOT_OZ * stopDistanceUsd;
  const riskAmountCcy = riskUsd / inp.gbpUsdRate;

  const rewardDistanceUsd =
    inp.takeProfit != null ? Math.abs(inp.takeProfit - inp.entry) : 2 * stopDistanceUsd;
  const rewardUsd = suggestedLots * LOT_OZ * rewardDistanceUsd;
  const rewardAmountCcy = rewardUsd / inp.gbpUsdRate;

  const pctOfAccount = inp.accountSize > 0 ? (riskAmountCcy / inp.accountSize) * 100 : 0;

  const sizingNote = tooSmall
    ? 'POSITION TOO SMALL — stop distance too wide for this account at your risk %. Do not force this trade.'
    : `Your size: ${suggestedLots.toFixed(2)} lots (risking ~${sym}${riskAmountCcy.toFixed(
        2,
      )} ≈ ${pctOfAccount.toFixed(2)}% of account)`;

  return {
    stopDistanceUsd,
    rawLots,
    suggestedLots,
    riskAmountCcy,
    rewardAmountCcy,
    tooSmall,
    sizingNote,
  };
}
