import { computeIndicators, MIN_CANDLES } from './indicators';
import { Candle } from './support-resistance';

function makeCandles(n: number): Candle[] {
  const out: Candle[] = [];
  for (let i = 0; i < n; i++) {
    const close = 1000 + 50 * Math.sin(i / 7) + 20 * Math.cos(i / 13) + i * 0.1;
    const high = close + 2 + Math.abs(Math.sin(i));
    const low = close - 2 - Math.abs(Math.cos(i));
    out.push({
      ts: new Date(Date.UTC(2024, 0, 1) + i * 3_600_000).toISOString(),
      open: close,
      high,
      low,
      close,
    });
  }
  return out;
}

describe('computeIndicators — minimum-data guard (spec 2)', () => {
  it('(d) returns null with fewer than 250 candles', () => {
    expect(computeIndicators(makeCandles(MIN_CANDLES - 1))).toBeNull();
  });

  it('(d) returns a full snapshot with >= 250 candles', () => {
    const values = computeIndicators(makeCandles(MIN_CANDLES));
    expect(values).not.toBeNull();
    const v = values!;
    expect(v.rsi_14).not.toBeNull();
    expect(v.macd).not.toBeNull();
    expect(v.macd_signal).not.toBeNull();
    expect(v.macd_hist).not.toBeNull();
    expect(v.ema_20).not.toBeNull();
    expect(v.ema_50).not.toBeNull();
    expect(v.ema_200).not.toBeNull(); // 250 >= 200 -> present
    expect(v.atr_14).not.toBeNull();
    expect(typeof v.ts).toBe('string');
  });
});
