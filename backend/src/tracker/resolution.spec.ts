import { resolveSignal, countTradingDays, ResolvableSignal, Candle15 } from './resolution';

function c(ts: string, high: number, low: number, close = (high + low) / 2): Candle15 {
  return { ts, open: close, high, low, close };
}

// BUY: entry 100, stop 98 (risk 2), tp 104. entry candle at 2024-01-01T00:00Z.
const buy: ResolvableSignal = {
  direction: 'BUY',
  entryPrice: 100,
  stopLoss: 98,
  takeProfit: 104,
  entryTs: '2024-01-01T00:00:00.000Z',
};
// SELL mirror: entry 100, stop 102 (risk 2), tp 96.
const sell: ResolvableSignal = {
  direction: 'SELL',
  entryPrice: 100,
  stopLoss: 102,
  takeProfit: 96,
  entryTs: '2024-01-01T00:00:00.000Z',
};

describe('(a) HIT_TP', () => {
  it('BUY resolves HIT_TP at +2.0R when a later candle high >= tp (low never <= stop)', () => {
    const candles = [
      c('2024-01-01T00:15:00.000Z', 101, 99.5),
      c('2024-01-01T00:30:00.000Z', 104.2, 100.5), // high >= 104
    ];
    const r = resolveSignal(buy, candles)!;
    expect(r.status).toBe('HIT_TP');
    expect(r.resolvedPrice).toBe(104);
    expect(r.pipsResult).toBe(4);
    expect(r.rMultiple).toBeCloseTo(2.0, 9);
    expect(r.resolvedTs).toBe('2024-01-01T00:30:00.000Z');
  });

  it('SELL resolves HIT_TP at +2.0R when a later candle low <= tp', () => {
    const candles = [c('2024-01-01T00:30:00.000Z', 100.5, 95.9)];
    const r = resolveSignal(sell, candles)!;
    expect(r.status).toBe('HIT_TP');
    expect(r.resolvedPrice).toBe(96);
    expect(r.pipsResult).toBe(4);
    expect(r.rMultiple).toBeCloseTo(2.0, 9);
  });
});

describe('(b) HIT_SL', () => {
  it('BUY resolves HIT_SL at -1.0R when a later candle low <= stop', () => {
    const candles = [c('2024-01-01T00:15:00.000Z', 100.5, 97.5)]; // low <= 98
    const r = resolveSignal(buy, candles)!;
    expect(r.status).toBe('HIT_SL');
    expect(r.resolvedPrice).toBe(98);
    expect(r.pipsResult).toBe(-2);
    expect(r.rMultiple).toBeCloseTo(-1.0, 9);
  });
});

describe('(c) BOTH stop and target in one candle -> conservative HIT_SL', () => {
  it('resolves HIT_SL and records the ambiguity in notes', () => {
    const candles = [c('2024-01-01T00:15:00.000Z', 104.5, 97.5)]; // spans 98 and 104
    const r = resolveSignal(buy, candles)!;
    expect(r.status).toBe('HIT_SL');
    expect(r.rMultiple).toBeCloseTo(-1.0, 9);
    expect(r.notes).toContain('touched both stop');
    expect(r.notes).toContain('HIT_SL');
  });
});

describe('(d) EXPIRY after > 5 trading days, weekend-aware', () => {
  it('EXPIRES at the latest close with signed R when never touched', () => {
    // entry Mon 2024-01-01; candles drift but never touch 98/104; now 8 trading days later.
    const candles = [
      c('2024-01-02T00:15:00.000Z', 101, 99.5, 100.5),
      c('2024-01-10T00:15:00.000Z', 101.5, 99.8, 101), // latest close 101
    ];
    const r = resolveSignal(buy, candles, { now: '2024-01-11T00:00:00.000Z' })!;
    expect(r.status).toBe('EXPIRED');
    expect(r.resolvedPrice).toBe(101); // latest close
    expect(r.pipsResult).toBe(1); // 101 - 100
    expect(r.rMultiple).toBeCloseTo(0.5, 9); // 1 / risk(2)
  });

  it('does NOT expire at exactly 5 trading days', () => {
    // Mon 2024-01-01 -> Mon 2024-01-08 = Tue..Fri (4) + Mon (1) = 5 trading days.
    const r = resolveSignal(buy, [], { now: '2024-01-08T12:00:00.000Z' });
    expect(r).toBeNull();
  });

  it('countTradingDays skips the weekend (Fri -> Mon = 1 trading day over 3 calendar days)', () => {
    // 2024-01-05 is Friday, 2024-01-08 is Monday.
    expect(countTradingDays('2024-01-05T12:00:00.000Z', '2024-01-08T12:00:00.000Z')).toBe(1);
    // Mon -> next Tue spans a weekend: Tue,Wed,Thu,Fri + Mon,Tue = 6 trading days.
    expect(countTradingDays('2024-01-01T00:00:00.000Z', '2024-01-09T00:00:00.000Z')).toBe(6);
  });
});

describe('(e) NO LOOK-AHEAD', () => {
  it('ignores candles at or before the entry candle; only strictly-later candles resolve', () => {
    const candles = [
      c('2023-12-31T23:45:00.000Z', 104.5, 97.5), // BEFORE entry — would have hit both
      c('2024-01-01T00:00:00.000Z', 104.5, 97.5), // AT entry — must be ignored
      c('2024-01-01T00:15:00.000Z', 104.2, 100.5), // AFTER entry — this one resolves (TP)
    ];
    const r = resolveSignal(buy, candles)!;
    expect(r.status).toBe('HIT_TP'); // not HIT_SL from the pre-entry candle
    expect(r.resolvedTs).toBe('2024-01-01T00:15:00.000Z');
  });

  it('truncating pre-entry candles does not change the result', () => {
    const all = [
      c('2023-12-31T23:45:00.000Z', 104.5, 97.5),
      c('2024-01-01T00:00:00.000Z', 104.5, 97.5),
      c('2024-01-01T00:15:00.000Z', 104.2, 100.5),
    ];
    const onlyAfter = all.filter((x) => x.ts > buy.entryTs);
    expect(JSON.stringify(resolveSignal(buy, all))).toBe(JSON.stringify(resolveSignal(buy, onlyAfter)));
  });
});
