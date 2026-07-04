import { evaluateFromContext, EvaluateOptions } from './signal-engine';
import { SignalContext } from './factors';
import { CORE_STOP, EXPERIMENTAL_STOP, HIGHER_TF, MIN_CONFLUENCE_EXPERIMENTAL } from './signals.constants';

/** A BUY context that scores 6/6 and fires (entry=100, ATR=2). */
function baseBuyContext(): SignalContext {
  return {
    higherClose: 110, // > higherEMA200 -> F1 buy
    higherEMA200: 100,
    ema20: 105, // > ema50 -> F2 buy (uptrend)
    ema50: 100,
    rsiPrev: 25, // crossed up through 30 -> F3
    rsiCurr: 35,
    macdPrev: { macd: -1, signal: 0 }, // bullish crossover -> F4
    macdCurr: { macd: 1, signal: 0 },
    atr: 2,
    close: 100,
    lastHigh: 100.5, // close in top 40% of range -> F6 (pos = 1/1.5 = 0.667)
    lastLow: 99.0,
    nearestSupport: 99.9, // within 0.5*ATR of support -> F5
    nearestResistance: 104,
  };
}

const coreOpts: EvaluateOptions = {
  minScore: 4,
  minRr: 2.0,
  stopFloorMult: CORE_STOP.floor,
  stopCeilMult: CORE_STOP.ceil,
  existingOpenDirections: [],
};

describe('(b) POSITIVE — full-confluence BUY fires exactly one correct signal', () => {
  it('fires with correct direction/score/entry/stop/tp/rr and all factors', () => {
    const r = evaluateFromContext(baseBuyContext(), coreOpts);
    expect(r.fired).toBe(true);
    expect(r.direction).toBe('BUY');
    expect(r.score).toBe(6);
    expect(r.factors!.F1.pass && r.factors!.F2.pass).toBe(true);
    expect(r.levels!.entry).toBeCloseTo(100, 9);
    expect(r.levels!.stop).toBeCloseTo(98, 9); // support 99.9 -> tighter than 1*ATR -> 1*ATR clamp
    expect(r.levels!.takeProfit).toBeCloseTo(104, 9);
    expect(r.levels!.rr).toBeCloseTo(2.0, 9);
  });

  it('the same direction is rejected as duplicate once OPEN (=> exactly one)', () => {
    const r = evaluateFromContext(baseBuyContext(), { ...coreOpts, existingOpenDirections: ['BUY'] });
    expect(r.fired).toBe(false);
    expect(r.reason).toBe('duplicate_open');
  });
});

describe('(a) ADVERSARIAL REJECTIONS', () => {
  it('score = 3 -> insufficient_score (only F1,F2,F6 true)', () => {
    const ctx = baseBuyContext();
    ctx.rsiPrev = 50; // kill F3 (no cross, not rising)
    ctx.rsiCurr = 50;
    ctx.macdPrev = { macd: 1, signal: 0 }; // kill F4 (no crossover)
    ctx.macdCurr = { macd: 1, signal: 0 };
    ctx.nearestSupport = 90; // kill F5 (structure far)
    const r = evaluateFromContext(ctx, coreOpts);
    expect(r.fired).toBe(false);
    expect(r.reason).toBe('insufficient_score');
    expect(r.score).toBe(3);
  });

  it('only ONE trend factor true -> no_candidate_direction', () => {
    const ctx = baseBuyContext();
    ctx.ema20 = 100; // ema20 == ema50 -> F2 neutral (neither buy nor sell)
    ctx.ema50 = 100;
    const r = evaluateFromContext(ctx, coreOpts);
    expect(r.fired).toBe(false);
    expect(r.reason).toBe('no_candidate_direction');
  });

  it('trend factors DISAGREE (F1 BUY, F2 SELL) -> trend_factors_disagree', () => {
    const ctx = baseBuyContext();
    ctx.ema20 = 95; // ema20 < ema50 -> F2 sell, while F1 is buy
    ctx.ema50 = 100;
    const r = evaluateFromContext(ctx, coreOpts);
    expect(r.fired).toBe(false);
    expect(r.reason).toBe('trend_factors_disagree');
  });

  it('RR below the required ratio -> rr_below_min (guard)', () => {
    // RR is 2.0 by construction; force a rejection by requiring > 2.0.
    const r = evaluateFromContext(baseBuyContext(), { ...coreOpts, minRr: 2.5 });
    expect(r.fired).toBe(false);
    expect(r.reason).toBe('rr_below_min');
    expect(r.levels!.rr).toBeCloseTo(2.0, 9);
  });

  it('duplicate OPEN same direction/timeframe -> duplicate_open', () => {
    const r = evaluateFromContext(baseBuyContext(), { ...coreOpts, existingOpenDirections: ['BUY'] });
    expect(r.fired).toBe(false);
    expect(r.reason).toBe('duplicate_open');
  });
});

describe('(e) TRACK SEPARATION', () => {
  const expOpts: EvaluateOptions = {
    minScore: MIN_CONFLUENCE_EXPERIMENTAL, // 5
    minRr: 2.0,
    stopFloorMult: EXPERIMENTAL_STOP.floor,
    stopCeilMult: EXPERIMENTAL_STOP.ceil,
    existingOpenDirections: [],
  };

  it('15min experimental requires >= 5/6 (score 4 does NOT fire)', () => {
    const ctx = baseBuyContext();
    ctx.nearestSupport = 90; // drop F5 -> score 5... keep one more off to reach 4
    ctx.rsiPrev = 50; // drop F3
    ctx.rsiCurr = 50;
    const r = evaluateFromContext(ctx, expOpts); // score 4 (F1,F2,F4,F6)
    expect(r.score).toBe(4);
    expect(r.fired).toBe(false);
    expect(r.reason).toBe('insufficient_score');
  });

  it('15min experimental fires at exactly 5/6', () => {
    const ctx = baseBuyContext();
    ctx.nearestSupport = 90; // drop F5 -> score 5
    const r = evaluateFromContext(ctx, expOpts);
    expect(r.score).toBe(5);
    expect(r.fired).toBe(true);
  });

  it('core 1h/4h fires at 4/6', () => {
    const ctx = baseBuyContext();
    ctx.nearestSupport = 90; // F5 off
    ctx.rsiPrev = 50; // F3 off -> score 4
    ctx.rsiCurr = 50;
    const r = evaluateFromContext(ctx, coreOpts);
    expect(r.score).toBe(4);
    expect(r.fired).toBe(true);
  });

  it('F1 higher-TF mapping: 15min uses 1h, 1h uses 4h, 4h uses 1day', () => {
    expect(HIGHER_TF['15min']).toBe('1h');
    expect(HIGHER_TF['1h']).toBe('4h');
    expect(HIGHER_TF['4h']).toBe('1day');
  });
});
