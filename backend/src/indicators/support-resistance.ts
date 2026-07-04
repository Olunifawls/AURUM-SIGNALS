export interface Candle {
  ts: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number | null;
}

export interface SupportResistance {
  supports: number[]; // nearest-first, strictly below current price (up to 3)
  resistances: number[]; // nearest-first, strictly above current price (up to 3)
  nearestSupport: number | null;
  nearestResistance: number | null;
}

/** Default clustering band: swings within 0.15% of each other merge into one level. */
export const CLUSTER_PCT = 0.0015;

/** Fractal needs 2 confirmed candles on each side. */
const WING = 2;

/**
 * Merge levels that sit within `pct` of one another into a single averaged level.
 */
function clusterLevels(levels: number[], pct: number): number[] {
  if (levels.length === 0) return [];
  const sorted = [...levels].sort((a, b) => a - b);
  const clusters: number[][] = [[sorted[0]]];
  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i];
    const lastCluster = clusters[clusters.length - 1];
    const ref = lastCluster[lastCluster.length - 1];
    if (ref !== 0 && Math.abs(cur - ref) / ref <= pct) {
      lastCluster.push(cur);
    } else {
      clusters.push([cur]);
    }
  }
  return clusters.map((c) => c.reduce((a, b) => a + b, 0) / c.length);
}

/**
 * Confirmed fractal swing highs/lows and clustered S/R levels "as of" a given
 * candle index — NO LOOK-AHEAD (spec D6).
 *
 * A swing high at position p requires high[p] to strictly exceed the 2 candles
 * on EACH side; a swing low mirrors this on lows. Because the right-side
 * neighbours (p+1, p+2) are needed, a fractal at p is only CONFIRMED at candle
 * p + WING. Therefore, when evaluating "as of candle `asOf`", we only consider
 * positions p with p + WING <= asOf, and we never read any candle with index
 * greater than `asOf`. Slicing away candles after `asOf` yields an identical
 * result — which is exactly what the no-look-ahead test asserts.
 */
export function computeSupportResistance(
  candles: Candle[],
  asOf: number = candles.length - 1,
  clusterPct: number = CLUSTER_PCT,
): SupportResistance {
  const empty: SupportResistance = {
    supports: [],
    resistances: [],
    nearestSupport: null,
    nearestResistance: null,
  };
  if (asOf < 0 || asOf >= candles.length) return empty;

  const swings: number[] = [];
  // p ranges so that both wings exist AND the right wing is confirmed by `asOf`.
  for (let p = WING; p + WING <= asOf; p++) {
    const h = candles[p].high;
    const l = candles[p].low;

    let isHigh = true;
    let isLow = true;
    for (let w = 1; w <= WING; w++) {
      if (!(h > candles[p - w].high && h > candles[p + w].high)) isHigh = false;
      if (!(l < candles[p - w].low && l < candles[p + w].low)) isLow = false;
    }
    if (isHigh) swings.push(h);
    if (isLow) swings.push(l);
  }

  const levels = clusterLevels(swings, clusterPct);
  const price = candles[asOf].close;

  const below = levels.filter((lv) => lv < price).sort((a, b) => b - a); // nearest below first
  const above = levels.filter((lv) => lv > price).sort((a, b) => a - b); // nearest above first

  const supports = below.slice(0, 3);
  const resistances = above.slice(0, 3);

  return {
    supports,
    resistances,
    nearestSupport: supports.length ? supports[0] : null,
    nearestResistance: resistances.length ? resistances[0] : null,
  };
}
