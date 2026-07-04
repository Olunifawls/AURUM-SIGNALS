import { Direction } from './signals.constants';

export interface Levels {
  entry: number;
  stop: number;
  takeProfit: number;
  rr: number;
  tpStructureCapped: number | null;
  tpBeyondStructure: boolean;
}

/**
 * Corrected stop formula (implemented exactly per spec):
 *   BUY:  stop = min( entry − floor·ATR , max( entry − ceil·ATR , support − 0.25·ATR ) )
 *   SELL: stop = max( entry + floor·ATR , min( entry + ceil·ATR , resistance + 0.25·ATR ) )
 * i.e. the stop sits just beyond structure, but never tighter than floor·ATR and
 * never wider than ceil·ATR. When no structure level exists, the structure term
 * falls back to the widest bound (ceil·ATR).
 */
export function computeStop(
  direction: Direction,
  entry: number,
  atr: number,
  structureLevel: number | null,
  floorMult: number,
  ceilMult: number,
): number {
  if (direction === 'BUY') {
    const floor = entry - floorMult * atr; // tightest (closest to entry)
    const ceil = entry - ceilMult * atr; // widest
    const structure = structureLevel != null ? structureLevel - 0.25 * atr : ceil;
    return Math.min(floor, Math.max(ceil, structure));
  }
  const floor = entry + floorMult * atr;
  const ceil = entry + ceilMult * atr;
  const structure = structureLevel != null ? structureLevel + 0.25 * atr : ceil;
  return Math.max(floor, Math.min(ceil, structure));
}

/**
 * Full level set: fixed 2:1 take-profit, RR (== 2.0 by construction), the
 * counterfactual tp_structure_capped (nearest OPPOSING structure beyond entry),
 * and the tp_beyond_structure flag (TP overshoots opposing structure by
 * > 0.5·ATR).
 */
export function computeLevels(
  direction: Direction,
  entry: number,
  atr: number,
  nearestSupport: number | null,
  nearestResistance: number | null,
  floorMult: number,
  ceilMult: number,
): Levels {
  const structureLevel = direction === 'BUY' ? nearestSupport : nearestResistance;
  const stop = computeStop(direction, entry, atr, structureLevel, floorMult, ceilMult);

  const risk = direction === 'BUY' ? entry - stop : stop - entry;
  const takeProfit = direction === 'BUY' ? entry + 2.0 * risk : entry - 2.0 * risk;
  const rr = direction === 'BUY' ? (takeProfit - entry) / (entry - stop) : (entry - takeProfit) / (stop - entry);

  // Counterfactual: nearest opposing structure beyond entry in the profit direction.
  const opposing = direction === 'BUY' ? nearestResistance : nearestSupport;
  let tpStructureCapped: number | null = null;
  let tpBeyondStructure = false;
  if (opposing != null) {
    if (direction === 'BUY' && opposing > entry) {
      tpStructureCapped = opposing;
      tpBeyondStructure = takeProfit > opposing + 0.5 * atr;
    } else if (direction === 'SELL' && opposing < entry) {
      tpStructureCapped = opposing;
      tpBeyondStructure = takeProfit < opposing - 0.5 * atr;
    }
  }

  return { entry, stop, takeProfit, rr, tpStructureCapped, tpBeyondStructure };
}
