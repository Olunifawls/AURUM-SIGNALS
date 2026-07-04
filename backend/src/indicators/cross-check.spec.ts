import { EMA, RSI, MACD, ATR } from 'technicalindicators';
import { emaLast } from './ema';
import { rsiLast } from './rsi';
import { macdLast } from './macd';
import { atrLast } from './atr';

/**
 * (a-ii) Cross-check our own implementations against the `technicalindicators`
 * npm package over a longer (300-point) deterministic series.
 *
 * DEFINITION CHECK: the package uses Wilder smoothing for RSI and ATR, and
 * SMA-seeded EMA for EMA/MACD — the same definitions we implement. One nuance:
 * the package's ATR seeds its Wilder average from true ranges starting at the
 * SECOND candle, whereas we include tr[0] = high-low in the seed. Wilder
 * smoothing forgets its seed exponentially, so over 300 candles the LATEST
 * value (the only value we store) agrees to well within tolerance. The exact
 * seeding behaviour is pinned separately by the fixed-vector tests.
 *
 * We compare the LAST value of each indicator (what INC-2 persists).
 */
const N = 300;
const closes: number[] = [];
const highs: number[] = [];
const lows: number[] = [];
for (let i = 0; i < N; i++) {
  const c = 1000 + 50 * Math.sin(i / 7) + 20 * Math.cos(i / 13) + i * 0.1;
  closes.push(c);
  highs.push(c + 2 + Math.abs(Math.sin(i)));
  lows.push(c - 2 - Math.abs(Math.cos(i)));
}

const last = <T>(arr: T[]): T => arr[arr.length - 1];
const TOL = 1e-6;

describe('cross-check vs technicalindicators (last value)', () => {
  it.each([20, 50, 200])('EMA(%i) agrees within 1e-6', (period) => {
    const ref = last(EMA.calculate({ period, values: closes }));
    expect(emaLast(closes, period) as number).toBeCloseTo(ref, 6);
  });

  it('RSI(14) agrees within the package rounding (2 dp)', () => {
    // NOTE: technicalindicators rounds RSI output to 2 decimals (e.g. 22.79 vs
    // our 22.7885). That is a formatting choice, not a definition difference —
    // Wilder smoothing matches — so we compare within the 2-dp rounding band.
    const ref = last(RSI.calculate({ period: 14, values: closes }));
    expect(Math.abs((rsiLast(closes, 14) as number) - ref)).toBeLessThan(0.005);
  });

  it('MACD(12,26,9) agrees within 1e-6 on macd/signal/histogram', () => {
    const ref = last(
      MACD.calculate({
        values: closes,
        fastPeriod: 12,
        slowPeriod: 26,
        signalPeriod: 9,
        SimpleMAOscillator: false,
        SimpleMASignal: false,
      }),
    );
    const mine = macdLast(closes);
    expect(mine.macd as number).toBeCloseTo(ref.MACD as number, 6);
    expect(mine.signal as number).toBeCloseTo(ref.signal as number, 6);
    expect(mine.histogram as number).toBeCloseTo(ref.histogram as number, 6);
  });

  it('ATR(14) latest value agrees within 1e-6 (seed decays over 300 candles)', () => {
    const ref = last(ATR.calculate({ period: 14, high: highs, low: lows, close: closes }));
    expect(Math.abs((atrLast(highs, lows, closes, 14) as number) - ref)).toBeLessThan(TOL);
  });
});
