import { HaltType } from '../risk/trading-state.service';
import { isFeedStale } from '../alerts/alert-format';

export interface HaltSpec {
  type: HaltType;
  scope: 'NEW_ORDERS' | 'ALL';
  reason: string;
  requiresManual: boolean;
  clearsAt?: Date;
}

export const FEED_STALE_MIN = 20;

/** 45-min window after weekly/daily reopen during which FEED_STALE and the
 *  gap-based VOLATILITY_COOLDOWN check are suppressed. Gives ingestion time to
 *  store the first bar of the new session before staleness checks fire. */
export const REOPEN_GRACE_MS = 45 * 60_000;

/** True when now falls within the reopen grace window. */
export function isInReopenGrace(marketReopenTs: number | null, now: Date): boolean {
  if (marketReopenTs === null) return false;
  return now.getTime() - marketReopenTs < REOPEN_GRACE_MS;
}

/** §6 volatility cooldown: 15m range > 3×ATR14, OR 15m move > 2×hourly ATR, OR
 * spread > 2.5× its 24h average -> 2h cooldown (check 4a flag). */
export function evalVolatility(i: {
  lastRange: number;
  atr14: number;
  priceMove15m: number;
  hourlyAtr: number;
  spread: number;
  spread24hAvg: number;
  now: Date;
}): HaltSpec | null {
  const reasons: string[] = [];
  if (i.atr14 > 0 && i.lastRange > 3 * i.atr14) reasons.push(`15m range ${i.lastRange} > 3×ATR14 ${i.atr14}`);
  if (i.hourlyAtr > 0 && i.priceMove15m > 2 * i.hourlyAtr) reasons.push(`15m move ${i.priceMove15m} > 2×hourlyATR ${i.hourlyAtr}`);
  if (i.spread24hAvg > 0 && i.spread > 2.5 * i.spread24hAvg) reasons.push(`spread ${i.spread} > 2.5×24hAvg ${i.spread24hAvg}`);
  if (!reasons.length) return null;
  return { type: 'VOLATILITY_COOLDOWN', scope: 'NEW_ORDERS', reason: reasons.join('; '), requiresManual: false, clearsAt: new Date(i.now.getTime() + 2 * 3600_000) };
}

/** §6 session gap: open price gaps > 1.5× daily ATR -> no new positions for 4h. */
export function evalSessionGap(i: { openGap: number; dailyAtr: number; now: Date }): HaltSpec | null {
  if (i.dailyAtr > 0 && i.openGap > 1.5 * i.dailyAtr) {
    return { type: 'SESSION_GAP', scope: 'NEW_ORDERS', reason: `session gap ${i.openGap} > 1.5×dailyATR ${i.dailyAtr}`, requiresManual: false, clearsAt: new Date(i.now.getTime() + 4 * 3600_000) };
  }
  return null;
}

/** §6 daily loss: >= MAX_DAILY_LOSS_PCT -> halt; auto-reset next 00:00 UK. */
export function evalDailyLoss(i: { dailyLossPct: number; maxDailyPct: number; now: Date }): HaltSpec | null {
  if (i.dailyLossPct >= i.maxDailyPct) {
    return { type: 'DAILY_LOSS', scope: 'NEW_ORDERS', reason: `daily loss ${i.dailyLossPct.toFixed(2)}% >= ${i.maxDailyPct}%`, requiresManual: false, clearsAt: nextUkMidnight(i.now) };
  }
  return null;
}

/** §6 weekly loss: >= MAX_WEEKLY_LOSS_PCT -> halt; auto-reset Monday weekly open. */
export function evalWeeklyLoss(i: { weeklyLossPct: number; maxWeeklyPct: number; now: Date }): HaltSpec | null {
  if (i.weeklyLossPct >= i.maxWeeklyPct) {
    return { type: 'WEEKLY_LOSS', scope: 'NEW_ORDERS', reason: `weekly loss ${i.weeklyLossPct.toFixed(2)}% >= ${i.maxWeeklyPct}%`, requiresManual: false, clearsAt: nextWeeklyOpen(i.now) };
  }
  return null;
}

/** §6/D6 absolute drawdown: equity <= (1 - MAX/100)×HWM -> halt ALL; manual /resume + confirm. */
export function evalDrawdown(i: { equity: number; highWaterMark: number; maxDrawdownPct: number }): HaltSpec | null {
  const floor = (1 - i.maxDrawdownPct / 100) * i.highWaterMark;
  if (i.highWaterMark > 0 && i.equity <= floor) {
    return { type: 'DRAWDOWN', scope: 'ALL', reason: `equity ${i.equity} <= ${floor.toFixed(2)} (HWM ${i.highWaterMark}, -${i.maxDrawdownPct}%)`, requiresManual: true };
  }
  return null;
}

/** §6 4 consecutive SL hits -> halt; manual /resume. `reasons` most-recent first. */
export function evalConsecutiveSl(reasons: string[], threshold = 4): HaltSpec | null {
  let count = 0;
  for (const r of reasons) {
    if (r === 'SL_HIT') count++;
    else break;
  }
  if (count >= threshold) {
    return { type: 'CONSECUTIVE_SL', scope: 'NEW_ORDERS', reason: `${count} consecutive SL hits`, requiresManual: true };
  }
  return null;
}

/** §6 data feed stale > 20 min -> no new orders; auto-clear on recovery.
 *  Pass reopenGraceUntil (epoch ms) to suppress during post-reopen grace window. */
export function evalFeedStale(
  lastTs: string | null,
  now: Date,
  marketOpen: boolean,
  reopenGraceUntil: number | null = null,
): HaltSpec | null {
  if (reopenGraceUntil !== null && now.getTime() < reopenGraceUntil) return null;
  if (isFeedStale(lastTs, now, marketOpen, FEED_STALE_MIN)) {
    return { type: 'FEED_STALE', scope: 'NEW_ORDERS', reason: 'data feed stale > 20 min', requiresManual: false };
  }
  return null;
}

/** §6 broker API errors ×5 in 10 min -> halt; manual /resume. */
export function evalBrokerErrors(errorTimestampsMs: number[], now: Date, windowMin = 10, threshold = 5): HaltSpec | null {
  const cutoff = now.getTime() - windowMin * 60_000;
  const n = errorTimestampsMs.filter((t) => t >= cutoff).length;
  if (n >= threshold) {
    return { type: 'BROKER_ERROR', scope: 'NEW_ORDERS', reason: `${n} broker errors in ${windowMin} min`, requiresManual: true };
  }
  return null;
}

// --- time helpers (approximate DST handling is acceptable for halt rollovers) ---

function ukOffsetMs(d: Date): number {
  const utc = new Date(d.toLocaleString('en-US', { timeZone: 'UTC' }));
  const uk = new Date(d.toLocaleString('en-US', { timeZone: 'Europe/London' }));
  return uk.getTime() - utc.getTime();
}

export function nextUkMidnight(now: Date): Date {
  const off = ukOffsetMs(now);
  const ukDay = Math.floor((now.getTime() + off) / 86400_000);
  return new Date((ukDay + 1) * 86400_000 - off);
}

export function nextWeeklyOpen(now: Date): Date {
  // Weekly open = Sunday 22:00 UTC (matches session.ts).
  const d = new Date(now);
  let t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 22, 0, 0);
  const day = new Date(t).getUTCDay();
  t += ((0 - day + 7) % 7) * 86400_000;
  if (t <= now.getTime()) t += 7 * 86400_000;
  return new Date(t);
}
