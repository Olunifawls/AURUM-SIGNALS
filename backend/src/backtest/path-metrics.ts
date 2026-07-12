import { Candle15, Direction } from '../tracker/resolution';

export interface PathMetrics {
  mfe_r: number;
  mae_r: number;
  cross_0_5r_ts: string | null;
  cross_1r_ts: string | null;
  cross_1_5r_ts: string | null;
  cross_2r_ts: string | null;
  /** After first reaching +1R: did price fall to ≤ 0R before +1.5R? null = never reached +1R. */
  retraced_from_1r: boolean | null;
  /** After first reaching +1.5R: did price fall to ≤ +1R before +2R? null = never reached +1.5R. */
  retraced_from_1_5r: boolean | null;
  candles_in_path: number;
}

/**
 * Compute per-trade path metrics from post-entry 15min candles.
 *
 * All candles are assumed to be strictly AFTER entry (ts > entryTs) and sorted
 * ascending — the same contract as tracker.service fetch15mAfter().
 *
 * Conservative intrabar rule: when a single bar could trigger both a retrace
 * and a continuation, the retrace (adverse) wins — consistent with resolveSignal().
 */
export function computePathMetrics(
  direction: Direction,
  entryPrice: number,
  initialStopLoss: number,
  candles: Candle15[],
): PathMetrics {
  const buy = direction === 'BUY';
  const risk = Math.abs(entryPrice - initialStopLoss);

  if (risk === 0) {
    return {
      mfe_r: 0, mae_r: 0, candles_in_path: candles.length,
      cross_0_5r_ts: null, cross_1r_ts: null, cross_1_5r_ts: null, cross_2r_ts: null,
      retraced_from_1r: null, retraced_from_1_5r: null,
    };
  }

  let mfe = 0;
  let mae = 0;

  const targets = [0.5, 1.0, 1.5, 2.0] as const;
  const crossTs: Record<number, string | null> = { 0.5: null, 1.0: null, 1.5: null, 2.0: null };

  let retrace1r: boolean | null = null;
  let retrace1_5r: boolean | null = null;

  for (const c of candles) {
    if (buy) {
      const fav = c.high - entryPrice;
      const adv = entryPrice - c.low;
      if (fav > mfe) mfe = fav;
      if (adv > mae) mae = adv;
    } else {
      const fav = entryPrice - c.low;
      const adv = c.high - entryPrice;
      if (fav > mfe) mfe = fav;
      if (adv > mae) mae = adv;
    }

    // Update R-crossing timestamps (first touch only).
    for (const t of targets) {
      if (crossTs[t] !== null) continue;
      const hit = buy
        ? c.high >= entryPrice + t * risk
        : c.low <= entryPrice - t * risk;
      if (hit) crossTs[t] = c.ts;
    }

    // After crossing +1R: watch for retrace to 0R or continuation to +1.5R.
    // Conservative: adverse (retrace) wins if the same bar hits both.
    if (crossTs[1.0] !== null && retrace1r === null) {
      const adv0r = buy ? c.low <= entryPrice : c.high >= entryPrice;
      const fav15r = buy ? c.high >= entryPrice + 1.5 * risk : c.low <= entryPrice - 1.5 * risk;
      if (adv0r) {
        retrace1r = true;
      } else if (fav15r) {
        retrace1r = false;
      }
    }

    // After crossing +1.5R: watch for retrace to +1R or continuation to +2R.
    if (crossTs[1.5] !== null && retrace1_5r === null) {
      const adv1r = buy ? c.low <= entryPrice + risk : c.high >= entryPrice - risk;
      const fav2r = buy ? c.high >= entryPrice + 2 * risk : c.low <= entryPrice - 2 * risk;
      if (adv1r) {
        retrace1_5r = true;
      } else if (fav2r) {
        retrace1_5r = false;
      }
    }
  }

  // Finalize: null retrace after the window closed = neither retrace nor continuation occurred.
  if (crossTs[1.0] !== null && retrace1r === null) retrace1r = false;
  if (crossTs[1.5] !== null && retrace1_5r === null) retrace1_5r = false;

  return {
    mfe_r: round4(mfe / risk),
    mae_r: round4(mae / risk),
    candles_in_path: candles.length,
    cross_0_5r_ts: crossTs[0.5],
    cross_1r_ts: crossTs[1.0],
    cross_1_5r_ts: crossTs[1.5],
    cross_2r_ts: crossTs[2.0],
    retraced_from_1r: crossTs[1.0] !== null ? retrace1r : null,
    retraced_from_1_5r: crossTs[1.5] !== null ? retrace1_5r : null,
  };
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
