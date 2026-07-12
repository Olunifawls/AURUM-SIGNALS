import { Candle15, Direction } from '../tracker/resolution';

export type ExitRuleId = 'BASELINE' | 'CURRENT' | 'RATCHET' | 'PARTIAL' | 'REVERSAL_EXIT';
export type ExitReason =
  | 'TP'
  | 'SL'
  | 'BE_STOP'
  | 'RATCHET_STOP'
  | 'REVERSAL_CLOSE'
  | 'EXPIRED';

export interface ExitSimResult {
  rMultiple: number;
  exitTs: string;
  exitReason: ExitReason;
}

/**
 * Simulate one of five exit rules on a sequence of post-entry 15min candles.
 *
 * Conservative intrabar rule (matches resolveSignal): when a single bar could
 * trigger both a stop and a target, the stop (adverse outcome) wins.
 *
 * State transitions (BE trigger, ratchet, partial) take effect FROM the next
 * bar — the same-bar low after a BE trigger is not checked as an immediate
 * stop. This is the standard bar-boundary convention.
 *
 * All candles must be strictly after entry (ts > entryTs), ascending.
 */
export function simulateExit(
  rule: ExitRuleId,
  direction: Direction,
  entryPrice: number,
  initialSL: number,
  takeProfit: number,
  candles: Candle15[],
): ExitSimResult {
  const buy = direction === 'BUY';
  const risk = Math.abs(entryPrice - initialSL);
  if (risk === 0 || candles.length === 0) {
    const last = candles[candles.length - 1];
    return {
      rMultiple: 0,
      exitTs: last?.ts ?? '',
      exitReason: 'EXPIRED',
    };
  }

  switch (rule) {
    case 'BASELINE':     return simBaseline(buy, entryPrice, risk, initialSL, takeProfit, candles);
    case 'CURRENT':      return simCurrent(buy, entryPrice, risk, initialSL, takeProfit, candles);
    case 'RATCHET':      return simRatchet(buy, entryPrice, risk, initialSL, takeProfit, candles);
    case 'PARTIAL':      return simPartial(buy, entryPrice, risk, initialSL, takeProfit, candles);
    case 'REVERSAL_EXIT':return simReversalExit(buy, entryPrice, risk, initialSL, takeProfit, candles);
  }
}

// ── helpers ──────────────────────────────────────────────────────────────────

function rOf(buy: boolean, entry: number, risk: number, price: number): number {
  const pips = buy ? price - entry : entry - price;
  return Math.round((pips / risk) * 100) / 100;
}

function expiry(buy: boolean, entry: number, risk: number, candles: Candle15[]): ExitSimResult {
  const last = candles[candles.length - 1];
  return { rMultiple: rOf(buy, entry, risk, last.close), exitTs: last.ts, exitReason: 'EXPIRED' };
}

// ── A. BASELINE — fixed 2:1, no breakeven ────────────────────────────────────

function simBaseline(
  buy: boolean, entry: number, risk: number,
  sl: number, tp: number, candles: Candle15[],
): ExitSimResult {
  for (const c of candles) {
    const hitSL = buy ? c.low <= sl : c.high >= sl;
    if (hitSL) return { rMultiple: -1, exitTs: c.ts, exitReason: 'SL' };
    const hitTP = buy ? c.high >= tp : c.low <= tp;
    if (hitTP) return { rMultiple: 2, exitTs: c.ts, exitReason: 'TP' };
  }
  return expiry(buy, entry, risk, candles);
}

// ── B. CURRENT — breakeven stop at +1R, hold to 2R ──────────────────────────

function simCurrent(
  buy: boolean, entry: number, risk: number,
  sl: number, tp: number, candles: Candle15[],
): ExitSimResult {
  let currentSL = sl;
  let beSet = false;
  for (const c of candles) {
    const hitSL = buy ? c.low <= currentSL : c.high >= currentSL;
    if (hitSL) {
      return {
        rMultiple: beSet ? 0 : -1,
        exitTs: c.ts,
        exitReason: beSet ? 'BE_STOP' : 'SL',
      };
    }
    const hitTP = buy ? c.high >= tp : c.low <= tp;
    if (hitTP) return { rMultiple: 2, exitTs: c.ts, exitReason: 'TP' };
    if (!beSet) {
      const at1R = buy ? c.high >= entry + risk : c.low <= entry - risk;
      if (at1R) { currentSL = entry; beSet = true; }
    }
  }
  return expiry(buy, entry, risk, candles);
}

// ── C. RATCHET — BE at +1R, move stop to +1R once price reaches +1.5R ───────

function simRatchet(
  buy: boolean, entry: number, risk: number,
  sl: number, tp: number, candles: Candle15[],
): ExitSimResult {
  let currentSL = sl;
  let beSet = false;
  let ratchetSet = false;
  for (const c of candles) {
    const hitSL = buy ? c.low <= currentSL : c.high >= currentSL;
    if (hitSL) {
      let rMultiple: number;
      let exitReason: ExitReason;
      if (!beSet)       { rMultiple = -1; exitReason = 'SL'; }
      else if (!ratchetSet) { rMultiple = 0; exitReason = 'BE_STOP'; }
      else              { rMultiple = 1; exitReason = 'RATCHET_STOP'; }
      return { rMultiple, exitTs: c.ts, exitReason };
    }
    const hitTP = buy ? c.high >= tp : c.low <= tp;
    if (hitTP) return { rMultiple: 2, exitTs: c.ts, exitReason: 'TP' };
    if (!beSet) {
      const at1R = buy ? c.high >= entry + risk : c.low <= entry - risk;
      if (at1R) { currentSL = entry; beSet = true; }
    } else if (!ratchetSet) {
      const at1_5R = buy ? c.high >= entry + 1.5 * risk : c.low <= entry - 1.5 * risk;
      if (at1_5R) {
        currentSL = buy ? entry + risk : entry - risk;
        ratchetSet = true;
      }
    }
  }
  return expiry(buy, entry, risk, candles);
}

// ── D. PARTIAL — close half at +1R, run remainder to 2R with BE stop ─────────

function simPartial(
  buy: boolean, entry: number, risk: number,
  sl: number, tp: number, candles: Candle15[],
): ExitSimResult {
  let currentSL = sl;
  let partialTaken = false;
  for (const c of candles) {
    if (!partialTaken) {
      const hitSL = buy ? c.low <= currentSL : c.high >= currentSL;
      if (hitSL) return { rMultiple: -1, exitTs: c.ts, exitReason: 'SL' };
      const hitTP = buy ? c.high >= tp : c.low <= tp;
      if (hitTP) return { rMultiple: 2, exitTs: c.ts, exitReason: 'TP' };
      const at1R = buy ? c.high >= entry + risk : c.low <= entry - risk;
      if (at1R) {
        currentSL = entry;
        partialTaken = true;
        // BE state takes effect from the next bar (bar-boundary convention).
      }
    } else {
      // Remaining 50% with BE stop at entry.
      const hitBE = buy ? c.low <= currentSL : c.high >= currentSL;
      if (hitBE) return { rMultiple: 0.5, exitTs: c.ts, exitReason: 'BE_STOP' };
      const hitTP = buy ? c.high >= tp : c.low <= tp;
      if (hitTP) {
        const remainR = rOf(buy, entry, risk, tp);
        return { rMultiple: round2(0.5 + 0.5 * remainR), exitTs: c.ts, exitReason: 'TP' };
      }
    }
  }
  const last = candles[candles.length - 1];
  if (partialTaken) {
    const remainR = rOf(buy, entry, risk, last.close);
    return { rMultiple: round2(0.5 + 0.5 * remainR), exitTs: last.ts, exitReason: 'EXPIRED' };
  }
  return expiry(buy, entry, risk, candles);
}

// ── E. REVERSAL_EXIT — once ≥ +1.5R, exit on first 15min close against pos ──

function simReversalExit(
  buy: boolean, entry: number, risk: number,
  sl: number, tp: number, candles: Candle15[],
): ExitSimResult {
  let monitoring = false;
  for (const c of candles) {
    if (!monitoring) {
      // Conservative: SL before TP.
      const hitSL = buy ? c.low <= sl : c.high >= sl;
      if (hitSL) return { rMultiple: -1, exitTs: c.ts, exitReason: 'SL' };
    }
    // TP is a hard limit — takes priority over reversal close.
    const hitTP = buy ? c.high >= tp : c.low <= tp;
    if (hitTP) return { rMultiple: 2, exitTs: c.ts, exitReason: 'TP' };
    // Trigger monitoring when +1.5R is first reached (this bar or later).
    if (!monitoring) {
      const at1_5R = buy ? c.high >= entry + 1.5 * risk : c.low <= entry - 1.5 * risk;
      if (at1_5R) monitoring = true;
    }
    // Once monitoring: exit on the first candle that CLOSES against the position.
    if (monitoring) {
      const reversal = buy ? c.close < c.open : c.close > c.open;
      if (reversal) {
        return { rMultiple: rOf(buy, entry, risk, c.close), exitTs: c.ts, exitReason: 'REVERSAL_CLOSE' };
      }
    }
  }
  return expiry(buy, entry, risk, candles);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
