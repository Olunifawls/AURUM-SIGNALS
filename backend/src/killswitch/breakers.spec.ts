import {
  REOPEN_GRACE_MS,
  evalBrokerErrors,
  evalConsecutiveSl,
  evalDailyLoss,
  evalDrawdown,
  evalFeedStale,
  evalSessionGap,
  evalVolatility,
  evalWeeklyLoss,
  isInReopenGrace,
  isSanePriceMove,
  nextUkMidnight,
  nextWeeklyOpen,
} from './breakers';

const now = new Date('2026-07-08T12:00:00Z');
const calm = { lastRange: 1, atr14: 5, priceMove15m: 1, hourlyAtr: 8, spread: 0.3, spread24hAvg: 0.3, now };

describe('(a) circuit breakers — each fires and sets the correct halt', () => {
  it('volatility: 15m range > 3×ATR14', () => {
    const s = evalVolatility({ ...calm, lastRange: 20, atr14: 5 });
    expect(s?.type).toBe('VOLATILITY_COOLDOWN');
    expect(s?.requiresManual).toBe(false);
    expect(s?.clearsAt?.getTime()).toBe(now.getTime() + 2 * 3600_000);
  });
  it('volatility: 15m move > 2×hourly ATR, or spread > 2.5×24h avg', () => {
    expect(evalVolatility({ ...calm, priceMove15m: 20, hourlyAtr: 8 })?.type).toBe('VOLATILITY_COOLDOWN');
    expect(evalVolatility({ ...calm, spread: 1.0, spread24hAvg: 0.3 })?.type).toBe('VOLATILITY_COOLDOWN');
    expect(evalVolatility(calm)).toBeNull();
  });
  it('session gap > 1.5×daily ATR', () => {
    expect(evalSessionGap({ openGap: 30, dailyAtr: 15, now })?.type).toBe('SESSION_GAP');
    expect(evalSessionGap({ openGap: 10, dailyAtr: 15, now })).toBeNull();
  });
  it('daily loss >= MAX_DAILY_LOSS_PCT (auto-reset next 00:00 UK)', () => {
    const s = evalDailyLoss({ dailyLossPct: 3.5, maxDailyPct: 3, now });
    expect(s?.type).toBe('DAILY_LOSS');
    expect(s?.requiresManual).toBe(false);
    expect(s?.clearsAt!.getTime()).toBeGreaterThan(now.getTime());
    expect(evalDailyLoss({ dailyLossPct: 2, maxDailyPct: 3, now })).toBeNull();
  });
  it('weekly loss >= MAX_WEEKLY_LOSS_PCT (auto-reset Monday)', () => {
    expect(evalWeeklyLoss({ weeklyLossPct: 6.5, maxWeeklyPct: 6, now })?.type).toBe('WEEKLY_LOSS');
  });
  it('absolute drawdown: equity <= (1-20%)×HWM -> manual halt, scope ALL', () => {
    const s = evalDrawdown({ equity: 80000, highWaterMark: 100000, maxDrawdownPct: 20 });
    expect(s?.type).toBe('DRAWDOWN');
    expect(s?.requiresManual).toBe(true);
    expect(s?.scope).toBe('ALL');
    expect(evalDrawdown({ equity: 80001, highWaterMark: 100000, maxDrawdownPct: 20 })).toBeNull();
  });
  it('4 consecutive SL hits -> manual halt', () => {
    expect(evalConsecutiveSl(['SL_HIT', 'SL_HIT', 'SL_HIT', 'SL_HIT'])?.type).toBe('CONSECUTIVE_SL');
    expect(evalConsecutiveSl(['SL_HIT', 'SL_HIT', 'TP_HIT', 'SL_HIT'])).toBeNull(); // broken streak
    expect(evalConsecutiveSl(['SL_HIT', 'BREAKEVEN_STOP', 'SL_HIT', 'SL_HIT'])).toBeNull(); // breakeven is not an SL hit
  });
  it('data feed stale > 20 min -> auto-clear halt', () => {
    const stale = new Date(now.getTime() - 25 * 60_000).toISOString();
    expect(evalFeedStale(stale, now, true)?.type).toBe('FEED_STALE');
    expect(evalFeedStale(new Date(now.getTime() - 5 * 60_000).toISOString(), now, true)).toBeNull();
  });
  it('broker API errors ×5 in 10 min -> manual halt', () => {
    const t = now.getTime();
    const five = [t - 1000, t - 2000, t - 3000, t - 4000, t - 5000];
    expect(evalBrokerErrors(five, now)?.type).toBe('BROKER_ERROR');
    expect(evalBrokerErrors(five.slice(0, 4), now)).toBeNull();
    expect(evalBrokerErrors([t - 20 * 60_000, t - 21 * 60_000, t - 22 * 60_000, t - 23 * 60_000, t - 24 * 60_000], now)).toBeNull(); // outside window
  });
  it('rollover helpers return future instants', () => {
    expect(nextUkMidnight(now).getTime()).toBeGreaterThan(now.getTime());
    expect(nextWeeklyOpen(now).getUTCDay()).toBe(0); // Sunday
  });
});

describe('(b) reopen grace — suppresses false FEED_STALE on weekly reopen, passes genuine mid-session loss', () => {
  // Sunday 22:06 UTC: market just reopened, last stored bar is from Friday 20:45 UTC (~49h ago).
  const reopenNow = new Date('2026-07-12T22:06:00Z');
  const FRIDAY_CLOSE_TS = new Date(reopenNow.getTime() - 49 * 3600_000).toISOString();

  it('confirms FEED_STALE would fire at Sunday reopen without grace (49h gap >> 20min)', () => {
    expect(evalFeedStale(FRIDAY_CLOSE_TS, reopenNow, true)?.type).toBe('FEED_STALE');
  });

  it('grace window suppresses FEED_STALE when reopenGraceUntil is in the future', () => {
    const graceUntil = reopenNow.getTime() + REOPEN_GRACE_MS;
    expect(evalFeedStale(FRIDAY_CLOSE_TS, reopenNow, true, graceUntil)).toBeNull();
  });

  it('FEED_STALE fires after grace expires with still-stale feed', () => {
    const graceUntil = reopenNow.getTime() - 1_000; // expired 1s ago
    expect(evalFeedStale(FRIDAY_CLOSE_TS, reopenNow, true, graceUntil)?.type).toBe('FEED_STALE');
  });

  it('genuine mid-session stale feed (30 min) fires with no grace recorded', () => {
    const midSession = new Date('2026-07-13T14:06:00Z');
    const stale30Min = new Date(midSession.getTime() - 30 * 60_000).toISOString();
    expect(evalFeedStale(stale30Min, midSession, true, null)?.type).toBe('FEED_STALE');
  });

  it('isInReopenGrace: true within grace window', () => {
    const reopenTs = reopenNow.getTime() - 20 * 60_000; // 20 min ago
    expect(isInReopenGrace(reopenTs, reopenNow)).toBe(true);
  });

  it('isInReopenGrace: false after grace expires (46 min ago)', () => {
    const reopenTs = reopenNow.getTime() - 46 * 60_000;
    expect(isInReopenGrace(reopenTs, reopenNow)).toBe(false);
  });

  it('isInReopenGrace: false with null (no reopen recorded)', () => {
    expect(isInReopenGrace(null, reopenNow)).toBe(false);
  });

  it('isInReopenGrace: exactly at boundary is still in grace', () => {
    const reopenTs = reopenNow.getTime() - REOPEN_GRACE_MS + 1; // 1ms before expiry
    expect(isInReopenGrace(reopenTs, reopenNow)).toBe(true);
  });

  it('isInReopenGrace: exactly expired is no longer in grace', () => {
    const reopenTs = reopenNow.getTime() - REOPEN_GRACE_MS; // exactly expired
    expect(isInReopenGrace(reopenTs, reopenNow)).toBe(false);
  });
});

describe('isSanePriceMove', () => {
  it('accepts moves up to 5% of price and rejects anything larger or unusable', () => {
    expect(isSanePriceMove(200, 4000)).toBe(true);
    expect(isSanePriceMove(200.01, 4000)).toBe(false);
    expect(isSanePriceMove(4140.95, 4140.95)).toBe(false); // the 15 Oct zero quote
    expect(isSanePriceMove(1, 0)).toBe(false);
    expect(isSanePriceMove(NaN, 4000)).toBe(false);
  });
});

describe('nextWeeklyOpen follows New York time', () => {
  const next = (t: string) => nextWeeklyOpen(new Date(t)).toISOString();

  it('is 22:00 UTC in winter and 21:00 UTC in daylight saving', () => {
    expect(next('2026-12-02T12:00:00Z')).toBe('2026-12-06T22:00:00.000Z');
    expect(next('2026-07-08T12:00:00Z')).toBe('2026-07-12T21:00:00.000Z');
  });

  it('uses the new offset when clocks go forward that Sunday', () => {
    expect(next('2026-03-04T12:00:00Z')).toBe('2026-03-08T21:00:00.000Z');
  });

  it('uses the new offset when clocks go back that Sunday', () => {
    expect(next('2026-10-28T12:00:00Z')).toBe('2026-11-01T22:00:00.000Z');
  });

  it('rolls to the next week at the open itself, and not before', () => {
    expect(next('2026-07-12T20:59:00Z')).toBe('2026-07-12T21:00:00.000Z');
    expect(next('2026-07-12T21:00:00Z')).toBe('2026-07-19T21:00:00.000Z');
  });

  it('handles a Sunday evening New York that is already Monday in UTC', () => {
    expect(next('2026-07-13T00:30:00Z')).toBe('2026-07-19T21:00:00.000Z');
  });

  it('crosses a month end', () => {
    expect(next('2026-10-30T12:00:00Z')).toBe('2026-11-01T22:00:00.000Z');
  });

  it('feeds the weekly-loss halt reset', () => {
    const h = evalWeeklyLoss({ weeklyLossPct: 7, maxWeeklyPct: 6, now: new Date('2026-07-08T12:00:00Z') });
    expect(h?.clearsAt?.toISOString()).toBe('2026-07-12T21:00:00.000Z');
  });
});
