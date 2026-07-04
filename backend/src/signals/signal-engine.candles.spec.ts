import { evaluateFromCandles, EvaluateOptions } from './signal-engine';
import { Candle } from '../indicators/support-resistance';
import { CORE_STOP } from './signals.constants';

function makeCandles(n: number, close: (i: number) => number): Candle[] {
  const out: Candle[] = [];
  for (let i = 0; i < n; i++) {
    const c = close(i);
    out.push({
      ts: new Date(Date.UTC(2024, 0, 1) + i * 3_600_000).toISOString(),
      open: c,
      high: c + 1 + Math.abs(Math.sin(i)),
      low: c - 1 - Math.abs(Math.cos(i)),
      close: c,
    });
  }
  return out;
}

const opts: EvaluateOptions = {
  minScore: 4,
  minRr: 2.0,
  stopFloorMult: CORE_STOP.floor,
  stopCeilMult: CORE_STOP.ceil,
  existingOpenDirections: [],
};

describe('(f) 4h GUARD via candle fixtures (higher-TF EMA200 needs >= 200 daily candles)', () => {
  const signal = makeCandles(300, (i) => 1000 + i * 0.5); // plenty of signal-TF data

  it('with < 200 daily candles, no signal (insufficient_higher_data == 4h guard)', () => {
    const higher = makeCandles(199, (i) => 1000 + i * 2);
    const r = evaluateFromCandles(signal, higher, opts);
    expect(r.fired).toBe(false);
    expect(r.reason).toBe('insufficient_higher_data');
  });

  it('with >= 200 daily candles, it evaluates (no longer blocked by the guard)', () => {
    const higher = makeCandles(250, (i) => 1000 + i * 2);
    const r = evaluateFromCandles(signal, higher, opts);
    expect(r.reason).not.toBe('insufficient_higher_data');
  });
});

describe('end-to-end candle path runs without error and returns a valid result', () => {
  it('produces a structured decision from raw candles', () => {
    const signal = makeCandles(300, (i) => 1000 + 30 * Math.sin(i / 9) + i * 0.1);
    const higher = makeCandles(300, (i) => 1000 + i * 1.5);
    const r = evaluateFromCandles(signal, higher, opts);
    expect(typeof r.fired).toBe('boolean');
    if (!r.fired) expect(typeof r.reason).toBe('string');
    if (r.fired) {
      expect(r.levels!.rr).toBeGreaterThanOrEqual(2.0 - 1e-9);
      expect(['BUY', 'SELL']).toContain(r.direction);
    }
  });
});
