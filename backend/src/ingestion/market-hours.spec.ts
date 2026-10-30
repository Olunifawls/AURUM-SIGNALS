import { isGoldMarketOpen } from './market-hours';

describe('isGoldMarketOpen', () => {
  it('is OPEN on a Wednesday', () => {
    const wed = new Date('2024-01-03T12:00:00Z'); // 2024-01-03 is a Wednesday
    expect(wed.getUTCDay()).toBe(3);
    expect(isGoldMarketOpen(wed)).toBe(true);
  });

  it('is CLOSED on a Saturday', () => {
    const sat = new Date('2024-01-06T12:00:00Z'); // 2024-01-06 is a Saturday
    expect(sat.getUTCDay()).toBe(6);
    expect(isGoldMarketOpen(sat)).toBe(false);
  });

  it('closes at Friday 22:00 UTC (open at 21:59, closed at 22:00)', () => {
    const friOpen = new Date('2024-01-05T21:59:00Z'); // Friday
    const friClosed = new Date('2024-01-05T22:00:00Z'); // Friday
    expect(friOpen.getUTCDay()).toBe(5);
    expect(isGoldMarketOpen(friOpen)).toBe(true);
    expect(isGoldMarketOpen(friClosed)).toBe(false);
  });

  it('reopens at Sunday 22:00 UTC (closed at 21:59, open at 22:00)', () => {
    const sunClosed = new Date('2024-01-07T21:59:00Z'); // Sunday
    const sunOpen = new Date('2024-01-07T22:00:00Z'); // Sunday
    expect(sunClosed.getUTCDay()).toBe(0);
    expect(isGoldMarketOpen(sunClosed)).toBe(false);
    expect(isGoldMarketOpen(sunOpen)).toBe(true);
  });

  // US clocks go forward 2026-03-08 and back 2026-11-01.
  describe('across US daylight saving', () => {
    it('closes at 22:00 UTC on the last Friday before clocks go forward (EST)', () => {
      expect(isGoldMarketOpen(new Date('2026-03-06T21:59:00Z'))).toBe(true);
      expect(isGoldMarketOpen(new Date('2026-03-06T22:00:00Z'))).toBe(false);
    });

    it('reopens at 21:00 UTC on the Sunday clocks go forward (02:00 local, already EDT by 17:00)', () => {
      expect(isGoldMarketOpen(new Date('2026-03-08T20:59:00Z'))).toBe(false);
      expect(isGoldMarketOpen(new Date('2026-03-08T21:00:00Z'))).toBe(true);
    });

    it('closes at 21:00 UTC on the first Friday of daylight saving', () => {
      expect(isGoldMarketOpen(new Date('2026-03-13T20:59:00Z'))).toBe(true);
      expect(isGoldMarketOpen(new Date('2026-03-13T21:00:00Z'))).toBe(false);
    });

    it('closes at 21:00 UTC on the last Friday before clocks go back (EDT)', () => {
      expect(isGoldMarketOpen(new Date('2026-10-30T20:59:00Z'))).toBe(true);
      expect(isGoldMarketOpen(new Date('2026-10-30T21:00:00Z'))).toBe(false);
    });

    it('reopens at 22:00 UTC on the Sunday clocks go back (EST by 17:00)', () => {
      expect(isGoldMarketOpen(new Date('2026-11-01T21:59:00Z'))).toBe(false);
      expect(isGoldMarketOpen(new Date('2026-11-01T22:00:00Z'))).toBe(true);
    });

    it('closes at 22:00 UTC on the first Friday after clocks go back', () => {
      expect(isGoldMarketOpen(new Date('2026-11-06T21:59:00Z'))).toBe(true);
      expect(isGoldMarketOpen(new Date('2026-11-06T22:00:00Z'))).toBe(false);
    });

    it('treats the UTC small hours of Saturday as Friday evening New York, still closed', () => {
      expect(isGoldMarketOpen(new Date('2026-07-11T00:30:00Z'))).toBe(false);
    });
  });
});
