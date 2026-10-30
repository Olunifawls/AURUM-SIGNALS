import { LONDON, NEW_YORK, zonedParts, zonedTimeToUtc } from './timezone';

describe('timezone', () => {
  it('reads New York wall-clock parts on both sides of a DST change', () => {
    expect(zonedParts(new Date('2026-10-30T20:00:00Z'), NEW_YORK)).toMatchObject({ weekday: 5, hour: 16, minute: 0 });
    expect(zonedParts(new Date('2026-11-06T20:00:00Z'), NEW_YORK)).toMatchObject({ weekday: 5, hour: 15, minute: 0 });
  });

  it('converts 08:30 New York to UTC with the right offset for the date', () => {
    expect(zonedTimeToUtc(2026, 10, 14, 8, 30, NEW_YORK).toISOString()).toBe('2026-10-14T12:30:00.000Z');
    expect(zonedTimeToUtc(2026, 11, 6, 8, 30, NEW_YORK).toISOString()).toBe('2026-11-06T13:30:00.000Z');
  });

  it('handles the week the UK has changed clocks and New York has not', () => {
    expect(zonedTimeToUtc(2027, 11, 5, 13, 30, LONDON).toISOString()).toBe('2027-11-05T13:30:00.000Z');
    expect(zonedTimeToUtc(2027, 11, 5, 8, 30, NEW_YORK).toISOString()).toBe('2027-11-05T12:30:00.000Z');
  });
});
