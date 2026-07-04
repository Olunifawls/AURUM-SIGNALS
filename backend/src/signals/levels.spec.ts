import { computeStop, computeLevels } from './levels';
import { CORE_STOP, EXPERIMENTAL_STOP } from './signals.constants';

const { floor, ceil } = CORE_STOP; // 1.0, 2.0

describe('(c) STOP formula — BUY (entry=100, ATR=2)', () => {
  const entry = 100;
  const atr = 2;

  it('uses the structure stop when structure sits between 1x and 2x ATR', () => {
    // support=97.5 -> 97.5 - 0.25*2 = 97.0 (distance 3 = 1.5*ATR)
    expect(computeStop('BUY', entry, atr, 97.5, floor, ceil)).toBeCloseTo(97.0, 9);
  });

  it('clamps to 2x ATR when structure is further than 2x ATR', () => {
    // support=90 -> 89.5, but never wider than entry-2*ATR = 96
    expect(computeStop('BUY', entry, atr, 90, floor, ceil)).toBeCloseTo(96.0, 9);
  });

  it('clamps to 1x ATR when structure is tighter than 1x ATR', () => {
    // support=99.5 -> 99.0, but never tighter than entry-1*ATR = 98
    expect(computeStop('BUY', entry, atr, 99.5, floor, ceil)).toBeCloseTo(98.0, 9);
  });
});

describe('(c) STOP formula — SELL (entry=100, ATR=2)', () => {
  const entry = 100;
  const atr = 2;

  it('uses the structure stop when structure sits between 1x and 2x ATR', () => {
    // resistance=102.5 -> 103.0 (distance 3 = 1.5*ATR)
    expect(computeStop('SELL', entry, atr, 102.5, floor, ceil)).toBeCloseTo(103.0, 9);
  });

  it('clamps to 2x ATR when structure is further than 2x ATR', () => {
    // resistance=110 -> 110.5, but never wider than entry+2*ATR = 104
    expect(computeStop('SELL', entry, atr, 110, floor, ceil)).toBeCloseTo(104.0, 9);
  });

  it('clamps to 1x ATR when structure is tighter than 1x ATR', () => {
    // resistance=100.5 -> 101.0, but never tighter than entry+1*ATR = 102
    expect(computeStop('SELL', entry, atr, 100.5, floor, ceil)).toBeCloseTo(102.0, 9);
  });
});

describe('experimental stop uses a tighter (1.5x ATR) ceiling', () => {
  it('clamps to 1.5x ATR where core would clamp to 2x ATR', () => {
    const core = computeStop('BUY', 100, 2, 90, CORE_STOP.floor, CORE_STOP.ceil);
    const exp = computeStop('BUY', 100, 2, 90, EXPERIMENTAL_STOP.floor, EXPERIMENTAL_STOP.ceil);
    expect(core).toBeCloseTo(96.0, 9); // entry - 2*ATR
    expect(exp).toBeCloseTo(97.0, 9); // entry - 1.5*ATR
  });
});

describe('(d) TAKE-PROFIT is exactly 2:1, with counterfactual + flag', () => {
  it('BUY tp = entry + 2*(entry-stop) and RR = 2.0', () => {
    // support=97.5 -> stop 97 ; tp = 100 + 2*3 = 106 ; rr = 6/3 = 2
    const lv = computeLevels('BUY', 100, 2, 97.5, 104, floor, ceil);
    expect(lv.stop).toBeCloseTo(97.0, 9);
    expect(lv.takeProfit).toBeCloseTo(106.0, 9);
    expect(lv.rr).toBeCloseTo(2.0, 9);
  });

  it('records tp_structure_capped = nearest opposing structure beyond entry', () => {
    const lv = computeLevels('BUY', 100, 2, 97.5, 104, floor, ceil);
    expect(lv.tpStructureCapped).toBeCloseTo(104, 9);
  });

  it('sets tp_beyond_structure when TP overshoots opposing structure by > 0.5*ATR', () => {
    // tp=106 vs resistance 104: 106 > 104 + 0.5*2 = 105 -> flag TRUE
    const flagged = computeLevels('BUY', 100, 2, 97.5, 104, floor, ceil);
    expect(flagged.tpBeyondStructure).toBe(true);
    // resistance 105.9: 106 > 105.9 + 1 = 106.9 -> flag FALSE
    const notFlagged = computeLevels('BUY', 100, 2, 97.5, 105.9, floor, ceil);
    expect(notFlagged.tpBeyondStructure).toBe(false);
  });

  it('SELL mirrors: tp = entry - 2*(stop-entry), RR = 2.0', () => {
    // resistance=102.5 -> stop 103 ; tp = 100 - 2*3 = 94 ; rr = 6/3 = 2
    const lv = computeLevels('SELL', 100, 2, 96, 102.5, floor, ceil);
    expect(lv.stop).toBeCloseTo(103.0, 9);
    expect(lv.takeProfit).toBeCloseTo(94.0, 9);
    expect(lv.rr).toBeCloseTo(2.0, 9);
  });
});
