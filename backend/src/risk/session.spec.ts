import { sessionFlags } from './session';

describe('session timing (check 3)', () => {
  it('mid-week is open with no edge windows', () => {
    const wed = new Date('2026-07-08T12:00:00Z'); // Wednesday
    expect(sessionFlags(wed)).toEqual({ marketOpen: true, inFirstWindow: false, inLastWindow: false });
  });

  it('flags the first 2h after weekly open (Sun 17:00–19:00 New York)', () => {
    const sun = new Date('2026-07-05T22:30:00Z'); // Sunday 18:30 New York (EDT)
    const f = sessionFlags(sun);
    expect(f.marketOpen).toBe(true);
    expect(f.inFirstWindow).toBe(true);
  });

  it('flags the last 2h before weekly close (Fri 15:00–17:00 New York)', () => {
    const fri = new Date('2026-12-04T21:00:00Z'); // Friday 21:00 UTC (16:00 New York, EST)
    const f = sessionFlags(fri);
    expect(f.marketOpen).toBe(true);
    expect(f.inLastWindow).toBe(true);
  });

  it('is closed on Saturday', () => {
    expect(sessionFlags(new Date('2026-07-11T12:00:00Z')).marketOpen).toBe(false);
  });

  // US clocks go forward 2026-03-08 and back 2026-11-01.
  describe('across US daylight saving', () => {
    const first = (t: string) => sessionFlags(new Date(t)).inFirstWindow;
    const last = (t: string) => sessionFlags(new Date(t)).inLastWindow;

    it.each([
      ['Sunday before clocks go forward (EST)', '2026-03-01T21:59:00Z', '2026-03-01T22:00:00Z', '2026-03-01T23:59:00Z', '2026-03-02T00:00:00Z'],
      ['Sunday clocks go forward (EDT)', '2026-03-08T20:59:00Z', '2026-03-08T21:00:00Z', '2026-03-08T22:59:00Z', '2026-03-08T23:00:00Z'],
      ['Sunday clocks go back (EST)', '2026-11-01T21:59:00Z', '2026-11-01T22:00:00Z', '2026-11-01T23:59:00Z', '2026-11-02T00:00:00Z'],
    ])('first window, %s', (_label, before, start, end, after) => {
      expect(first(before)).toBe(false);
      expect(first(start)).toBe(true);
      expect(first(end)).toBe(true);
      expect(first(after)).toBe(false);
    });

    it.each([
      ['last Friday before clocks go forward (EST)', '2026-03-06T19:59:00Z', '2026-03-06T20:00:00Z', '2026-03-06T21:59:00Z', '2026-03-06T22:00:00Z'],
      ['first Friday of daylight saving (EDT)', '2026-03-13T18:59:00Z', '2026-03-13T19:00:00Z', '2026-03-13T20:59:00Z', '2026-03-13T21:00:00Z'],
      ['last Friday before clocks go back (EDT)', '2026-10-30T18:59:00Z', '2026-10-30T19:00:00Z', '2026-10-30T20:59:00Z', '2026-10-30T21:00:00Z'],
      ['first Friday after clocks go back (EST)', '2026-11-06T19:59:00Z', '2026-11-06T20:00:00Z', '2026-11-06T21:59:00Z', '2026-11-06T22:00:00Z'],
    ])('last window, %s', (_label, before, start, end, after) => {
      expect(last(before)).toBe(false);
      expect(last(start)).toBe(true);
      expect(last(end)).toBe(true);
      expect(last(after)).toBe(false);
    });

    it('both windows are always inside market hours', () => {
      expect(sessionFlags(new Date('2026-07-10T20:59:00Z')).marketOpen).toBe(true);
      expect(sessionFlags(new Date('2026-07-05T21:00:00Z')).marketOpen).toBe(true);
    });
  });
});
