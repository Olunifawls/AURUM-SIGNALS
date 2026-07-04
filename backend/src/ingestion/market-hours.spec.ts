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
});
