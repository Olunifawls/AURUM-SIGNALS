export type Direction = 'BUY' | 'SELL';
export type TerminalStatus = 'HIT_TP' | 'HIT_SL' | 'EXPIRED';

export interface ResolvableSignal {
  direction: Direction;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  /** Resolution only considers 15min candles that CLOSED strictly after this. */
  entryTs: string;
}

export interface Candle15 {
  ts: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface Resolution {
  status: TerminalStatus;
  resolvedTs: string;
  resolvedPrice: number;
  pipsResult: number;
  rMultiple: number;
  notes: string | null;
}

/** A signal still OPEN after more than this many trading days expires. */
export const MAX_TRADING_DAYS = 5;

/** Trading day = a UTC weekday (Mon–Fri); weekends do not count. */
export function isTradingDay(date: Date): boolean {
  const d = date.getUTCDay();
  return d >= 1 && d <= 5;
}

/**
 * Number of trading days (weekdays) strictly after `startTs`'s date, up to and
 * including `endTs`'s date. Weekends are skipped.
 */
export function countTradingDays(startTs: string, endTs: string): number {
  const start = new Date(startTs);
  const end = new Date(endTs);
  if (end <= start) return 0;

  const cur = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  cur.setUTCDate(cur.getUTCDate() + 1); // start counting the day AFTER entry's date
  const endDate = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));

  let count = 0;
  while (cur <= endDate) {
    if (isTradingDay(cur)) count++;
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return count;
}

function finalize(
  sig: ResolvableSignal,
  status: TerminalStatus,
  resolvedPrice: number,
  resolvedTs: string,
  risk: number,
  notes: string | null,
): Resolution {
  const pipsResult =
    sig.direction === 'BUY' ? resolvedPrice - sig.entryPrice : sig.entryPrice - resolvedPrice;
  const rMultiple = risk !== 0 ? pipsResult / risk : 0;
  return { status, resolvedTs, resolvedPrice, pipsResult, rMultiple, notes };
}

/**
 * Resolve one OPEN signal against 15min candles (D5). Only candles strictly
 * after `entryTs` are considered (no look-ahead). Chronological, first touch
 * wins; a single candle touching BOTH levels resolves conservatively as HIT_SL.
 * Returns null if the signal is neither touched nor expired yet.
 */
export function resolveSignal(
  sig: ResolvableSignal,
  candles: Candle15[],
  opts: { now?: string; maxTradingDays?: number } = {},
): Resolution | null {
  const risk = Math.abs(sig.entryPrice - sig.stopLoss);
  const buy = sig.direction === 'BUY';

  const subsequent = candles
    .filter((c) => c.ts > sig.entryTs)
    .sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));

  for (const c of subsequent) {
    const hitSL = buy ? c.low <= sig.stopLoss : c.high >= sig.stopLoss;
    const hitTP = buy ? c.high >= sig.takeProfit : c.low <= sig.takeProfit;

    if (hitSL && hitTP) {
      return finalize(
        sig,
        'HIT_SL',
        sig.stopLoss,
        c.ts,
        risk,
        `Ambiguous: 15min candle at ${c.ts} touched both stop (${sig.stopLoss}) and target (${sig.takeProfit}); resolved conservatively as HIT_SL.`,
      );
    }
    if (hitSL) return finalize(sig, 'HIT_SL', sig.stopLoss, c.ts, risk, null);
    if (hitTP) return finalize(sig, 'HIT_TP', sig.takeProfit, c.ts, risk, null);
  }

  // No touch — check expiry.
  const now = opts.now ?? (subsequent.length ? subsequent[subsequent.length - 1].ts : sig.entryTs);
  const maxDays = opts.maxTradingDays ?? MAX_TRADING_DAYS;
  if (countTradingDays(sig.entryTs, now) > maxDays) {
    const latest = subsequent.length ? subsequent[subsequent.length - 1] : null;
    const resolvedPrice = latest ? latest.close : sig.entryPrice;
    const resolvedTs = latest ? latest.ts : now;
    return finalize(sig, 'EXPIRED', resolvedPrice, resolvedTs, risk, null);
  }

  return null;
}
