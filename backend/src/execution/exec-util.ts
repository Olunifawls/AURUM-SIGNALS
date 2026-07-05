import { countTradingDays } from '../tracker/resolution';

export type Side = 'BUY' | 'SELL';
export const TIME_STOP_TRADING_DAYS = 5;

export function slippagePoints(fillPrice: number, requestedPrice: number): number {
  return Math.abs(fillPrice - requestedPrice);
}

/** Achieved RR from the actual fill: |tp - fill| / |fill - stop|. */
export function achievedRr(fillPrice: number, stopLoss: number, takeProfit: number): number | null {
  const risk = Math.abs(fillPrice - stopLoss);
  if (risk === 0) return null;
  return Math.round((Math.abs(takeProfit - fillPrice) / risk) * 100) / 100;
}

/** Realized R (price-based, matches L1): favourable move / risk. */
export function realizedR(entry: number, stopLoss: number, closePrice: number, side: Side): number | null {
  const risk = Math.abs(entry - stopLoss);
  if (risk === 0) return null;
  const move = side === 'BUY' ? closePrice - entry : entry - closePrice;
  return Math.round((move / risk) * 100) / 100;
}

/** Infer why a broker-closed trade closed, from the close price vs SL/TP. */
export function inferCloseReason(closePrice: number, stopLoss: number, takeProfit: number): string {
  const span = Math.abs(takeProfit - stopLoss);
  const tol = Math.max(span * 0.02, 0.5); // 2% of the SL–TP span, min 0.5
  if (Math.abs(closePrice - takeProfit) <= tol) return 'TP_HIT';
  if (Math.abs(closePrice - stopLoss) <= tol) return 'SL_HIT';
  return 'CLOSED_AT_BROKER';
}

/** Whether an open position has exceeded the time stop (> 5 trading days). */
export function isTimeStopped(openedAt: string, now: Date, maxDays = TIME_STOP_TRADING_DAYS): boolean {
  return countTradingDays(openedAt, now.toISOString()) > maxDays;
}

/** Worst-case risk % at the actual fill, scaling the sized worst-case by how the
 * fill changed the stop distance (fills further from stop = more risk). */
export function actualRiskPctAtFill(
  sizedRiskPct: number,
  requestedEntry: number,
  stopLoss: number,
  fillPrice: number,
): number {
  const sized = Math.abs(requestedEntry - stopLoss);
  const actual = Math.abs(fillPrice - stopLoss);
  if (sized === 0) return sizedRiskPct;
  return Math.round(sizedRiskPct * (actual / sized) * 10000) / 10000;
}
