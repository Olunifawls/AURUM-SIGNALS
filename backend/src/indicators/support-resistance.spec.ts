import { computeSupportResistance, Candle } from './support-resistance';

function candle(high: number, low: number, close: number): Candle {
  return { ts: `t${high}-${low}-${close}`, open: close, high, low, close };
}

// A 12-candle series with a swing high at index 4 (confirmed at 6) and index 8
// (confirmed at 10), and swing lows at 4 and 8. Current price (close) is 11.
const candles: Candle[] = [
  candle(10, 9, 11),
  candle(11, 8, 11),
  candle(12, 7, 11),
  candle(13, 6, 11),
  candle(20, 5, 11), // index 4: swing HIGH (20) and swing LOW (5)
  candle(13, 6, 11),
  candle(12, 7, 11),
  candle(11, 8, 11),
  candle(18, 4, 11), // index 8: swing HIGH (18) and swing LOW (4)
  candle(11, 8, 11),
  candle(10, 9, 11),
  candle(9, 10, 11),
];

describe('Support/Resistance — NO LOOK-AHEAD (spec D6)', () => {
  it('(c) a fractal at position p is only usable from candle p+2 onward', () => {
    // Swing high at p=4 is NOT confirmed at p+1=5 ...
    expect(computeSupportResistance(candles, 5).nearestResistance).toBeNull();
    // ... but IS confirmed at p+2=6.
    expect(computeSupportResistance(candles, 6).nearestResistance).toBeCloseTo(20, 9);
  });

  it('(c) "as of candle i" uses NO candle with index > i (truncating the future changes nothing)', () => {
    for (let i = 4; i < candles.length; i++) {
      const full = computeSupportResistance(candles, i);
      const truncated = computeSupportResistance(candles.slice(0, i + 1), i);
      expect(JSON.stringify(full)).toBe(JSON.stringify(truncated));
    }
  });

  it('classifies confirmed swings relative to current price', () => {
    // As of the last candle: 20 & 18 are above price 11 (resistance), 5 & 4 below (support).
    const sr = computeSupportResistance(candles, candles.length - 1);
    expect(sr.resistances[0]).toBeCloseTo(18, 9); // nearest above 11
    expect(sr.supports[0]).toBeCloseTo(5, 9); // nearest below 11
  });

  it('clusters swings within 0.15% into a single level', () => {
    // Two swing highs ~0.1% apart should merge into one averaged level.
    const c: Candle[] = [
      candle(100, 90, 95),
      candle(101, 90, 95),
      candle(110.0, 90, 95), // swing high A
      candle(101, 90, 95),
      candle(102, 90, 95),
      candle(103, 90, 95),
      candle(110.1, 90, 95), // swing high B (~0.09% from A) -> clusters with A
      candle(103, 90, 95),
      candle(102, 90, 95),
    ];
    const sr = computeSupportResistance(c, c.length - 1);
    const near110 = sr.resistances.filter((r) => r > 109 && r < 111);
    expect(near110.length).toBe(1); // merged into one level
    expect(near110[0]).toBeCloseTo((110.0 + 110.1) / 2, 6);
  });
});
