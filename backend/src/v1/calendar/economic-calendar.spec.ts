import { LONDON, zonedParts } from '../../common/timezone';
import { calendarExpiryWarning, effectiveSchedule, firstFridayNfp, liveSourceEvents, mergeSchedules, staticEvents } from './economic-calendar';

const at = (name: string, iso: string) => ({ name, tier: name === 'PPI' ? 2 : 1, at: iso }) as any;

describe('static schedule', () => {
  const events = staticEvents();
  const find = (name: string, day: string) => events.find((e) => e.name === name && e.at.startsWith(day));

  it('has every release in Nov 2026 – Dec 2027', () => {
    const count = (n: string) => events.filter((e) => e.name === n).length;
    expect([count('NFP'), count('CPI'), count('PPI'), count('FOMC')]).toEqual([14, 14, 14, 9]);
  });

  it('marks NFP, CPI and FOMC tier 1 and PPI tier 2', () => {
    expect(new Set(events.filter((e) => e.tier === 1).map((e) => e.name))).toEqual(new Set(['NFP', 'CPI', 'FOMC']));
    expect(new Set(events.filter((e) => e.tier === 2).map((e) => e.name))).toEqual(new Set(['PPI']));
  });

  it('converts New York times with the right offset across DST', () => {
    expect(find('NFP', '2026-11-06')?.at).toBe('2026-11-06T13:30:00.000Z'); // EST
    expect(find('NFP', '2027-06-04')?.at).toBe('2027-06-04T12:30:00.000Z'); // EDT
    expect(find('FOMC', '2026-12-09')?.at).toBe('2026-12-09T19:00:00.000Z'); // EST
    expect(find('FOMC', '2027-07-28')?.at).toBe('2027-07-28T18:00:00.000Z'); // EDT
  });

  it('every date is a weekday', () => {
    for (const e of events) expect([1, 2, 3, 4, 5]).toContain(new Date(e.at).getUTCDay());
  });
});

describe('existing news source', () => {
  it('keeps the first-Friday NFP rule: first Friday, 13:30 UK', () => {
    for (const e of liveSourceEvents().filter((x) => x.name === 'NFP')) {
      expect(zonedParts(new Date(e.at), LONDON)).toMatchObject({ weekday: 5, hour: 13, minute: 30 });
      expect(zonedParts(new Date(e.at), LONDON).day).toBeLessThanOrEqual(7);
    }
  });

  it('computes first Fridays', () => {
    expect(firstFridayNfp(2027, 1)).toBe('2027-01-01T13:30:00.000Z');
    expect(firstFridayNfp(2026, 11)).toBe('2026-11-06T13:30:00.000Z');
    expect(firstFridayNfp(2027, 6)).toBe('2027-06-04T12:30:00.000Z'); // 13:30 BST
  });
});

describe('mergeSchedules', () => {
  it('passes matching releases through with no disagreement', () => {
    const e = at('NFP', '2026-11-06T13:30:00.000Z');
    expect(mergeSchedules([e], [e])).toEqual({ events: [e], disagreements: [] });
  });

  it('same day, live earlier: the official time wins and it is reported', () => {
    const r = mergeSchedules([at('CPI', '2026-11-10T13:30:00.000Z')], [at('CPI', '2026-11-10T12:30:00.000Z')]);
    expect(r.events.map((e) => e.at)).toEqual(['2026-11-10T13:30:00.000Z']);
    expect(r.disagreements).toEqual([{ name: 'CPI', staticAt: '2026-11-10T13:30:00.000Z', liveAt: '2026-11-10T12:30:00.000Z', usedAt: '2026-11-10T13:30:00.000Z' }]);
  });

  it('same day, live later: the official time wins and it is reported', () => {
    const r = mergeSchedules([at('NFP', '2027-11-05T12:30:00.000Z')], [at('NFP', '2027-11-05T13:30:00.000Z')]);
    expect(r.events.map((e) => e.at)).toEqual(['2027-11-05T12:30:00.000Z']);
    expect(r.disagreements[0].usedAt).toBe('2027-11-05T12:30:00.000Z');
  });

  it.each([
    ['NFP', '2027-01-08T13:30:00.000Z', '2027-01-01T13:30:00.000Z'], // 1 Jan is a US holiday
    ['NFP', '2027-10-08T12:30:00.000Z', '2027-10-01T12:30:00.000Z'],
    ['NFP', '2027-11-05T12:30:00.000Z', '2027-11-05T13:30:00.000Z'], // US still on summer time
    ['CPI', '2027-05-12T12:30:00.000Z', '2027-05-11T12:30:00.000Z'],
    ['FOMC', '2027-06-09T18:00:00.000Z', '2027-06-16T18:00:00.000Z'],
  ])('%s: only the official %s is scheduled, and the gap is reported', (name, staticAt, liveAt) => {
    const r = mergeSchedules([at(name, staticAt)], [at(name, liveAt)]);
    expect(r.events.map((e) => e.at)).toEqual([staticAt]);
    expect(r.disagreements).toEqual([{ name, staticAt, liveAt, usedAt: staticAt }]);
  });

  it('different days, live later: keeps only the official earlier release', () => {
    const r = mergeSchedules([at('NFP', '2026-07-02T12:30:00.000Z')], [at('NFP', '2026-07-03T12:30:00.000Z')]);
    expect(r.events.map((e) => e.at)).toEqual(['2026-07-02T12:30:00.000Z']);
  });

  it('keeps a release only the live source has', () => {
    const e = at('FOMC', '2026-09-16T18:00:00.000Z');
    expect(mergeSchedules([], [e]).events).toEqual([e]);
  });

  it('does not pair different events in the same month', () => {
    const r = mergeSchedules([at('CPI', '2026-11-10T13:30:00.000Z')], [at('NFP', '2026-11-06T13:30:00.000Z')]);
    expect(r.events).toHaveLength(2);
    expect(r.disagreements).toEqual([]);
  });
});

describe('effectiveSchedule', () => {
  const { events, disagreements } = effectiveSchedule();

  it('finds the three real disagreements with the first-Friday rule', () => {
    expect(disagreements.map((d) => [d.staticAt, d.liveAt])).toEqual([
      ['2027-01-08T13:30:00.000Z', '2027-01-01T13:30:00.000Z'],
      ['2027-10-08T12:30:00.000Z', '2027-10-01T12:30:00.000Z'],
      ['2027-11-05T12:30:00.000Z', '2027-11-05T13:30:00.000Z'],
    ]);
  });

  it('uses the official time for all three, and keeps the warning', () => {
    expect(disagreements.map((d) => d.usedAt)).toEqual(['2027-01-08T13:30:00.000Z', '2027-10-08T12:30:00.000Z', '2027-11-05T12:30:00.000Z']);
  });

  it('never loses an official release', () => {
    const times = new Set(events.map((e) => e.at));
    for (const e of staticEvents()) expect(times.has(e.at)).toBe(true);
  });

  it('schedules exactly the official releases wherever they have coverage', () => {
    const covered = events.filter((e) => e.at >= '2026-11-01');
    const official = staticEvents();
    expect(covered.map((e) => `${e.name} ${e.at}`).sort()).toEqual(official.map((e) => `${e.name} ${e.at}`).sort());
  });

  it('drops the first-Friday guesses', () => {
    const times = events.map((e) => e.at);
    expect(times).not.toContain('2027-01-01T13:30:00.000Z');
    expect(times).not.toContain('2027-10-01T12:30:00.000Z');
  });

  it('is sorted', () => {
    const times = events.map((e) => e.at);
    expect(times).toEqual([...times].sort());
  });
});

describe('calendarExpiryWarning', () => {
  const events = [at('CPI', '2026-11-10T13:30:00.000Z'), at('PPI', '2027-03-12T13:30:00.000Z')];
  const before = (days: number) => new Date(Date.parse('2027-03-12T13:30:00.000Z') - days * 86_400_000);

  it('is silent at exactly 60 days', () => {
    expect(calendarExpiryWarning(events, before(60))).toBeNull();
  });

  it('warns under 60 days, naming the last event', () => {
    const w = calendarExpiryWarning(events, before(59));
    expect(w).toContain('2027-03-12');
    expect(w).toContain('59 days');
  });

  it('says so when the calendar has run out, or is empty', () => {
    expect(calendarExpiryWarning(events, before(-1))).toContain('run out');
    expect(calendarExpiryWarning([], before(0))).toContain('run out');
  });

  it('is silent today, and first warns 60 days before the real last event', () => {
    const { events: real } = effectiveSchedule();
    expect(real[real.length - 1].at).toBe('2027-12-15T13:30:00.000Z');
    expect(calendarExpiryWarning(real, new Date('2026-11-01T00:00:00Z'))).toBeNull();
    expect(calendarExpiryWarning(real, new Date('2027-10-16T13:30:00Z'))).toBeNull();
    expect(calendarExpiryWarning(real, new Date('2027-10-17T00:00:00Z'))).toContain('2027-12-15');
  });
});
