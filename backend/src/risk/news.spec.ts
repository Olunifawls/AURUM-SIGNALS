import { BLACKOUT_MINUTES, FallbackNewsCalendar } from './news';

describe('(h) news fallback calendar (no live API)', () => {
  const cal = new FallbackNewsCalendar();
  const clearAt = (s: string) => cal.isInBlackout(new Date(s)).blackout === false;

  it('is flagged as degraded coverage (fallback source)', () => {
    expect(cal.degraded).toBe(true);
    expect(cal.source).toBe('fallback');
  });

  it('keeps the window at 30 minutes either side', () => {
    expect(BLACKOUT_MINUTES).toBe(30);
  });

  it('blocks NFP from the calendar, including the official date the old rule missed', () => {
    expect(cal.isInBlackout(new Date('2026-11-06T13:30:00Z'))).toEqual({ blackout: true, event: 'NFP' });
    expect(cal.isInBlackout(new Date('2027-01-08T13:30:00Z'))).toEqual({ blackout: true, event: 'NFP' });
  });

  it('blocks CPI, FOMC and PPI after the old list ran out in September', () => {
    expect(cal.isInBlackout(new Date('2026-11-10T13:30:00Z'))).toEqual({ blackout: true, event: 'CPI' });
    expect(cal.isInBlackout(new Date('2026-12-09T19:15:00Z'))).toEqual({ blackout: true, event: 'FOMC' });
    expect(cal.isInBlackout(new Date('2026-11-13T13:30:00Z'))).toEqual({ blackout: true, event: 'PPI' });
  });

  it('still blocks the events from the old config list', () => {
    expect(cal.isInBlackout(new Date('2026-07-14T12:30:00Z'))).toMatchObject({ blackout: true, event: 'CPI' });
    expect(cal.isInBlackout(new Date('2026-07-29T18:15:00Z'))).toMatchObject({ blackout: true, event: 'FOMC' });
  });

  it('includes both edges of the window and nothing beyond', () => {
    expect(clearAt('2026-11-10T13:00:00Z')).toBe(false);
    expect(clearAt('2026-11-10T14:00:00Z')).toBe(false);
    expect(clearAt('2026-11-10T12:59:59Z')).toBe(true);
    expect(clearAt('2026-11-10T14:00:01Z')).toBe(true);
  });

  it('is clear on a normal day', () => {
    expect(clearAt('2026-11-18T12:00:00Z')).toBe(true);
  });

  describe('exhausted calendar', () => {
    const one = new FallbackNewsCalendar([{ name: 'CPI', tier: 1, at: '2026-12-10T13:30:00.000Z' }]);

    it('is not exhausted in a quiet week with an event further out', () => {
      expect(one.isExhausted(new Date('2026-11-20T12:00:00Z'))).toBe(false); // 20 days away
    });

    it('is exhausted once the last event has passed', () => {
      expect(one.isExhausted(new Date('2026-12-10T13:30:00Z'))).toBe(true);
    });

    it('is exhausted with no events at all', () => {
      expect(new FallbackNewsCalendar([]).isExhausted(new Date('2026-11-20T12:00:00Z'))).toBe(true);
    });

    it('the real calendar is not exhausted during its longest gap', () => {
      expect(cal.isExhausted(new Date('2027-08-20T12:00:00Z'))).toBe(false);
    });

    it('the real calendar runs out after its last event', () => {
      expect(cal.isExhausted(new Date('2027-12-16T12:00:00Z'))).toBe(true);
    });
  });
});
