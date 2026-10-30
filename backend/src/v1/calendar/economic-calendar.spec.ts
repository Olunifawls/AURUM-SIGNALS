import { isNfpBlackout } from '../../risk/news';
import { effectiveSchedule, firstFridayNfp, liveSourceEvents, mergeSchedules, staticEvents } from './economic-calendar';

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
  it('reproduces the first-Friday NFP rule of risk/news.ts', () => {
    for (const e of liveSourceEvents().filter((x) => x.name === 'NFP')) {
      expect(isNfpBlackout(new Date(e.at))).toBe(true);
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

  it('same day, live earlier: uses the earlier time and reports it', () => {
    const r = mergeSchedules([at('CPI', '2026-11-10T13:30:00.000Z')], [at('CPI', '2026-11-10T12:30:00.000Z')]);
    expect(r.events.map((e) => e.at)).toEqual(['2026-11-10T12:30:00.000Z']);
    expect(r.disagreements).toEqual([{ name: 'CPI', staticAt: '2026-11-10T13:30:00.000Z', liveAt: '2026-11-10T12:30:00.000Z', usedAt: '2026-11-10T12:30:00.000Z' }]);
  });

  it('same day, static earlier: keeps the static time and reports it', () => {
    const r = mergeSchedules([at('NFP', '2027-11-05T12:30:00.000Z')], [at('NFP', '2027-11-05T13:30:00.000Z')]);
    expect(r.events.map((e) => e.at)).toEqual(['2027-11-05T12:30:00.000Z']);
    expect(r.disagreements[0].usedAt).toBe('2027-11-05T12:30:00.000Z');
  });

  it('different days, live earlier: uses the earlier time and keeps the official release', () => {
    const r = mergeSchedules([at('NFP', '2027-01-08T13:30:00.000Z')], [at('NFP', '2027-01-01T13:30:00.000Z')]);
    expect(r.events.map((e) => e.at)).toEqual(['2027-01-01T13:30:00.000Z', '2027-01-08T13:30:00.000Z']);
    expect(r.disagreements).toHaveLength(1);
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

  it('never loses an official release', () => {
    const times = new Set(events.map((e) => e.at));
    for (const e of staticEvents()) expect(times.has(e.at)).toBe(true);
  });

  it('is sorted', () => {
    const times = events.map((e) => e.at);
    expect(times).toEqual([...times].sort());
  });
});
