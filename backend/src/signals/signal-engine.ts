import { Candle } from '../indicators/support-resistance';
import { Direction } from './signals.constants';
import {
  SignalContext,
  ScoredFactors,
  resolveDirection,
  scoreFactors,
  buildSignalContext,
} from './factors';
import { computeLevels, Levels } from './levels';

export type RejectReason =
  | 'no_candidate_direction'
  | 'trend_factors_disagree'
  | 'trend_not_scored'
  | 'insufficient_score'
  | 'duplicate_open'
  | 'rr_below_min'
  | 'insufficient_signal_data'
  | 'insufficient_higher_data';

export interface EvaluateOptions {
  minScore: number;
  minRr: number;
  stopFloorMult: number;
  stopCeilMult: number;
  /** Directions with an existing OPEN signal on this timeframe. */
  existingOpenDirections: Direction[];
}

export interface EvaluationResult {
  fired: boolean;
  reason?: RejectReason;
  direction: Direction | null;
  score: number | null;
  factors: ScoredFactors | null;
  levels: Levels | null;
  detail?: Record<string, unknown>;
}

/**
 * Pure decision from an explicit context. Applies direction resolution, factor
 * scoring, and all four fire conditions in order, returning the reason on the
 * first that fails.
 */
export function evaluateFromContext(ctx: SignalContext, opts: EvaluateOptions): EvaluationResult {
  const res = resolveDirection(ctx);
  if (!res.direction) {
    // Distinguish "the two trend factors point in OPPOSITE directions" from
    // "the trend factors are simply not both aligned" (e.g. only one is true).
    const disagree = (res.f1buy && res.f2sell) || (res.f1sell && res.f2buy);
    return {
      fired: false,
      reason: disagree ? 'trend_factors_disagree' : 'no_candidate_direction',
      direction: null,
      score: null,
      factors: null,
      levels: null,
      detail: { ...res },
    };
  }

  const direction = res.direction;
  const factors = scoreFactors(direction, ctx);

  // Fire condition 2: F1 AND F2 must both be scored (guaranteed by candidate).
  if (!(factors.F1.pass && factors.F2.pass)) {
    return { fired: false, reason: 'trend_not_scored', direction, score: factors.score, factors, levels: null };
  }

  // Fire condition 1: score threshold.
  if (factors.score < opts.minScore) {
    return { fired: false, reason: 'insufficient_score', direction, score: factors.score, factors, levels: null };
  }

  // Fire condition 3: no existing OPEN signal in the same direction/timeframe.
  if (opts.existingOpenDirections.includes(direction)) {
    return { fired: false, reason: 'duplicate_open', direction, score: factors.score, factors, levels: null };
  }

  // Level calculator + Fire condition 4: RR >= min.
  const levels = computeLevels(
    direction,
    ctx.close,
    ctx.atr,
    ctx.nearestSupport,
    ctx.nearestResistance,
    opts.stopFloorMult,
    opts.stopCeilMult,
  );
  if (levels.rr < opts.minRr - 1e-9) {
    return { fired: false, reason: 'rr_below_min', direction, score: factors.score, factors, levels };
  }

  return { fired: true, direction, score: factors.score, factors, levels };
}

/**
 * Evaluate from candle series (builds the context first). Returns the
 * insufficient-data reason if the context cannot be built.
 */
export function evaluateFromCandles(
  signalCandles: Candle[],
  higherCandles: Candle[],
  opts: EvaluateOptions,
): EvaluationResult {
  const build = buildSignalContext(signalCandles, higherCandles);
  if (!build.ok) {
    return { fired: false, reason: build.reason, direction: null, score: null, factors: null, levels: null };
  }
  return evaluateFromContext(build.ctx, opts);
}
