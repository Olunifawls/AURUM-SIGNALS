import { emaLast } from './ema';
import { rsiLast } from './rsi';
import { macdLast } from './macd';
import { atrLast } from './atr';
import { computeSupportResistance, Candle } from './support-resistance';

/** Minimum candles required before emitting indicator values (spec 2). */
export const MIN_CANDLES = 250;

export interface IndicatorValues {
  ts: string;
  rsi_14: number | null;
  macd: number | null;
  macd_signal: number | null;
  macd_hist: number | null;
  ema_20: number | null;
  ema_50: number | null;
  ema_200: number | null;
  atr_14: number | null;
  nearest_support: number | null;
  nearest_resistance: number | null;
}

/**
 * Compute the LATEST indicator values from an ascending-by-time candle series.
 * Returns null when there is not enough data (< MIN_CANDLES) so the caller can
 * skip the write and log an INFO event.
 */
export function computeIndicators(candles: Candle[]): IndicatorValues | null {
  if (candles.length < MIN_CANDLES) return null;

  const closes = candles.map((c) => c.close);
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const last = candles.length - 1;

  const m = macdLast(closes);
  const sr = computeSupportResistance(candles, last);

  return {
    ts: candles[last].ts,
    rsi_14: rsiLast(closes, 14),
    macd: m.macd,
    macd_signal: m.signal,
    macd_hist: m.histogram,
    ema_20: emaLast(closes, 20),
    ema_50: emaLast(closes, 50),
    ema_200: emaLast(closes, 200),
    atr_14: atrLast(highs, lows, closes, 14),
    nearest_support: sr.nearestSupport,
    nearest_resistance: sr.nearestResistance,
  };
}
