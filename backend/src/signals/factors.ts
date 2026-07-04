import { emaLast } from '../indicators/ema';
import { rsiSeries } from '../indicators/rsi';
import { macdSeries } from '../indicators/macd';
import { atrLast } from '../indicators/atr';
import { computeSupportResistance, Candle } from '../indicators/support-resistance';
import { Direction } from './signals.constants';

/**
 * All numeric inputs the six factors need, at the latest candle. Building this
 * from candles is separated from the decision logic so the engine is trivially
 * testable with exact numbers.
 */
export interface SignalContext {
  higherClose: number;
  higherEMA200: number;
  ema20: number;
  ema50: number;
  rsiPrev: number;
  rsiCurr: number;
  macdPrev: { macd: number; signal: number };
  macdCurr: { macd: number; signal: number };
  atr: number;
  close: number; // entry = latest close
  lastHigh: number;
  lastLow: number;
  nearestSupport: number | null;
  nearestResistance: number | null;
}

export interface FactorResult {
  pass: boolean;
  [k: string]: unknown;
}

export interface ScoredFactors {
  F1: FactorResult;
  F2: FactorResult;
  F3: FactorResult;
  F4: FactorResult;
  F5: FactorResult;
  F6: FactorResult;
  score: number;
}

export interface DirectionResolution {
  direction: Direction | null;
  f1buy: boolean;
  f2buy: boolean;
  f1sell: boolean;
  f2sell: boolean;
  buyTrend: boolean;
  sellTrend: boolean;
}

/**
 * Candidate direction = the one where BOTH trend factors (F1 higher-TF, F2
 * local) hold. F1 and F2 are directional and mutually exclusive, so at most one
 * direction qualifies; if neither does, there is no candidate.
 */
export function resolveDirection(ctx: SignalContext): DirectionResolution {
  const f1buy = ctx.higherClose > ctx.higherEMA200;
  const f1sell = ctx.higherClose < ctx.higherEMA200;
  const f2buy = ctx.ema20 > ctx.ema50;
  const f2sell = ctx.ema20 < ctx.ema50;
  const buyTrend = f1buy && f2buy;
  const sellTrend = f1sell && f2sell;
  const direction: Direction | null = buyTrend ? 'BUY' : sellTrend ? 'SELL' : null;
  return { direction, f1buy, f2buy, f1sell, f2sell, buyTrend, sellTrend };
}

/** Score all six factors for a given candidate direction (1 point each). */
export function scoreFactors(direction: Direction, ctx: SignalContext): ScoredFactors {
  const buy = direction === 'BUY';

  // F1 higher-TF trend
  const F1: FactorResult = {
    pass: buy ? ctx.higherClose > ctx.higherEMA200 : ctx.higherClose < ctx.higherEMA200,
    higherClose: ctx.higherClose,
    higherEMA200: ctx.higherEMA200,
  };

  // F2 local trend
  const f2 = buy ? ctx.ema20 > ctx.ema50 : ctx.ema20 < ctx.ema50;
  const F2: FactorResult = { pass: f2, ema20: ctx.ema20, ema50: ctx.ema50 };

  // F3 RSI (trigger window = LAST 1 candle)
  const band = ctx.rsiCurr >= 40 && ctx.rsiCurr <= 60;
  const rising = ctx.rsiCurr > ctx.rsiPrev;
  const falling = ctx.rsiCurr < ctx.rsiPrev;
  const crossedUp30 = ctx.rsiPrev < 30 && ctx.rsiCurr >= 30;
  const crossedDown70 = ctx.rsiPrev > 70 && ctx.rsiCurr <= 70;
  const f3 = buy
    ? crossedUp30 || (band && rising && f2)
    : crossedDown70 || (band && falling && f2);
  const F3: FactorResult = {
    pass: f3,
    rsiPrev: ctx.rsiPrev,
    rsiCurr: ctx.rsiCurr,
    crossedUp30,
    crossedDown70,
    band,
    rising,
    falling,
  };

  // F4 MACD crossover (trigger window = LAST 1 candle)
  const f4 = buy
    ? ctx.macdPrev.macd <= ctx.macdPrev.signal && ctx.macdCurr.macd > ctx.macdCurr.signal
    : ctx.macdPrev.macd >= ctx.macdPrev.signal && ctx.macdCurr.macd < ctx.macdCurr.signal;
  const F4: FactorResult = { pass: f4, macdPrev: ctx.macdPrev, macdCurr: ctx.macdCurr };

  // F5 structure: within 0.5×ATR of support (BUY) / resistance (SELL)
  const level = buy ? ctx.nearestSupport : ctx.nearestResistance;
  const distance = level != null ? Math.abs(ctx.close - level) : null;
  const f5 = level != null && distance != null && distance <= 0.5 * ctx.atr;
  const F5: FactorResult = { pass: f5, level, distance, atr: ctx.atr };

  // F6 momentum quality: close in top 40% (BUY) / bottom 40% (SELL) of range
  const range = ctx.lastHigh - ctx.lastLow;
  const positionPct = range > 0 ? (ctx.close - ctx.lastLow) / range : null;
  const f6 = positionPct != null && (buy ? positionPct >= 0.6 : positionPct <= 0.4);
  const F6: FactorResult = { pass: f6, positionPct, high: ctx.lastHigh, low: ctx.lastLow };

  const score = [F1, F2, F3, F4, F5, F6].filter((f) => f.pass).length;
  return { F1, F2, F3, F4, F5, F6, score };
}

function lastTwoNums(series: (number | null)[]): [number, number] | null {
  const n = series.length;
  if (n < 2) return null;
  const a = series[n - 2];
  const b = series[n - 1];
  if (a == null || b == null) return null;
  return [a, b];
}

export type ContextBuild =
  | { ok: true; ctx: SignalContext }
  | { ok: false; reason: 'insufficient_signal_data' | 'insufficient_higher_data' };

/**
 * Derive a SignalContext from ascending candle series using the INC-2 indicator
 * functions. Returns a reason instead of a context when data is insufficient —
 * `insufficient_higher_data` is what backs the 4h guard (daily EMA-200 needs
 * >= 200 daily candles).
 */
export function buildSignalContext(
  signalCandles: Candle[],
  higherCandles: Candle[],
): ContextBuild {
  const closes = signalCandles.map((c) => c.close);
  const highs = signalCandles.map((c) => c.high);
  const lows = signalCandles.map((c) => c.low);

  const higherCloses = higherCandles.map((c) => c.close);
  const higherEMA200 = emaLast(higherCloses, 200);
  if (higherEMA200 == null || higherCandles.length === 0) {
    return { ok: false, reason: 'insufficient_higher_data' };
  }

  const ema20 = emaLast(closes, 20);
  const ema50 = emaLast(closes, 50);
  const atr = atrLast(highs, lows, closes, 14);
  const rsi2 = lastTwoNums(rsiSeries(closes, 14));
  const macd = macdSeries(closes);

  const macd2 =
    macd.length >= 2 &&
    macd[macd.length - 1].macd != null &&
    macd[macd.length - 1].signal != null &&
    macd[macd.length - 2].macd != null &&
    macd[macd.length - 2].signal != null
      ? {
          prev: {
            macd: macd[macd.length - 2].macd as number,
            signal: macd[macd.length - 2].signal as number,
          },
          curr: {
            macd: macd[macd.length - 1].macd as number,
            signal: macd[macd.length - 1].signal as number,
          },
        }
      : null;

  if (ema20 == null || ema50 == null || atr == null || rsi2 == null || macd2 == null) {
    return { ok: false, reason: 'insufficient_signal_data' };
  }

  const last = signalCandles[signalCandles.length - 1];
  const sr = computeSupportResistance(signalCandles);

  return {
    ok: true,
    ctx: {
      higherClose: higherCloses[higherCloses.length - 1],
      higherEMA200,
      ema20,
      ema50,
      rsiPrev: rsi2[0],
      rsiCurr: rsi2[1],
      macdPrev: macd2.prev,
      macdCurr: macd2.curr,
      atr,
      close: last.close,
      lastHigh: last.high,
      lastLow: last.low,
      nearestSupport: sr.nearestSupport,
      nearestResistance: sr.nearestResistance,
    },
  };
}
