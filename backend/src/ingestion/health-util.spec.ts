import { computeStale, STALE_THRESHOLD_MS } from './health-util';
import {
  estimateDailyTwelveDataCalls,
  estimateGatedDailyTwelveDataCalls,
  TWELVE_DATA_DAILY_LIMIT,
} from './ingestion.constants';

describe('computeStale', () => {
  const now = new Date('2024-01-03T12:00:00Z');

  it('is not stale when the market is closed, regardless of age', () => {
    expect(computeStale(null, now, false)).toBe(false);
    expect(computeStale('2024-01-01T00:00:00Z', now, false)).toBe(false);
  });

  it('is stale when the market is open and there is no ingestion yet', () => {
    expect(computeStale(null, now, true)).toBe(true);
  });

  it('is stale when the last 15min ingestion is older than the threshold', () => {
    const old = new Date(now.getTime() - STALE_THRESHOLD_MS - 60_000).toISOString();
    expect(computeStale(old, now, true)).toBe(true);
  });

  it('is fresh when the last 15min ingestion is within the threshold', () => {
    const recent = new Date(now.getTime() - 60_000).toISOString();
    expect(computeStale(recent, now, true)).toBe(false);
  });
});

describe('rate-budget estimate', () => {
  it('has a fully-open-day nominal near the ~450 target and a gated average well under it', () => {
    const nominal = estimateDailyTwelveDataCalls();
    // 288 + 96 + 24 + 1 + 48 = 457 on a fully-open day
    expect(nominal).toBe(457);
    expect(nominal).toBeLessThan(TWELVE_DATA_DAILY_LIMIT);

    // Market-hours gate skips weekends -> true weekly average ~326/day (<= 450).
    const gated = estimateGatedDailyTwelveDataCalls();
    expect(gated).toBe(326);
    expect(gated).toBeLessThanOrEqual(450);
  });
});
