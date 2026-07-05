import { FallbackNewsCalendar, isNfpBlackout } from './news';

describe('(h) news fallback calendar (no live API)', () => {
  const cal = new FallbackNewsCalendar();

  it('is flagged as degraded coverage (fallback source)', () => {
    expect(cal.degraded).toBe(true);
    expect(cal.source).toBe('fallback');
  });

  it('blocks NFP (first Friday 13:30 UK)', () => {
    // 2026-07-03 is the first Friday of July; 13:30 UK (BST) = 12:30 UTC.
    expect(isNfpBlackout(new Date('2026-07-03T12:30:00Z'))).toBe(true);
    expect(cal.isInBlackout(new Date('2026-07-03T12:30:00Z'))).toMatchObject({ blackout: true, event: 'NFP' });
    // outside the window (16:00 UK) -> clear
    expect(cal.isInBlackout(new Date('2026-07-03T15:00:00Z')).blackout).toBe(false);
    // a non-first Friday is not NFP
    expect(isNfpBlackout(new Date('2026-07-10T12:30:00Z'))).toBe(false);
  });

  it('blocks the committed config FOMC/CPI dates (±30 min)', () => {
    expect(cal.isInBlackout(new Date('2026-07-14T12:30:00Z'))).toMatchObject({ blackout: true, event: 'CPI' });
    expect(cal.isInBlackout(new Date('2026-07-29T18:15:00Z'))).toMatchObject({ blackout: true, event: 'FOMC' });
    // well outside any event
    expect(cal.isInBlackout(new Date('2026-07-14T15:00:00Z')).blackout).toBe(false);
  });
});
