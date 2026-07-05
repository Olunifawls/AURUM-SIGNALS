import { sessionFlags } from './session';

describe('session timing (check 3)', () => {
  it('mid-week is open with no edge windows', () => {
    const wed = new Date('2026-07-08T12:00:00Z'); // Wednesday
    expect(sessionFlags(wed)).toEqual({ marketOpen: true, inFirstWindow: false, inLastWindow: false });
  });

  it('flags the first 2h after weekly open (Sun >= 22:00 UTC)', () => {
    const sun = new Date('2026-07-05T22:30:00Z'); // Sunday 22:30 UTC
    const f = sessionFlags(sun);
    expect(f.marketOpen).toBe(true);
    expect(f.inFirstWindow).toBe(true);
  });

  it('flags the last 2h before weekly close (Fri 20:00–22:00 UTC)', () => {
    const fri = new Date('2026-07-10T21:00:00Z'); // Friday 21:00 UTC
    const f = sessionFlags(fri);
    expect(f.marketOpen).toBe(true);
    expect(f.inLastWindow).toBe(true);
  });

  it('is closed on Saturday', () => {
    expect(sessionFlags(new Date('2026-07-11T12:00:00Z')).marketOpen).toBe(false);
  });
});
