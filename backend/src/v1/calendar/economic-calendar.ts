import { LONDON, NEW_YORK, zonedParts, zonedTimeToUtc } from '../../common/timezone';
import { NEWS_EVENTS } from '../../risk/news-events';
import { CALENDAR_WARNING_DAYS, DAY_MS } from '../v1.constants';
import { CALENDAR_COVERAGE_END, EventName, STATIC_RELEASES } from './economic-calendar.data';

export { CALENDAR_COVERAGE_END } from './economic-calendar.data';

export interface EconomicEvent {
  name: EventName;
  tier: 1 | 2;
  at: string; // UTC ISO
}

export interface CalendarDisagreement {
  name: EventName;
  staticAt: string;
  liveAt: string;
  usedAt: string;
}

const TIER: Record<EventName, 1 | 2> = { NFP: 1, CPI: 1, FOMC: 1, PPI: 2 };

const iso = (d: Date): string => d.toISOString();
const makeEvent = (name: EventName, at: string): EconomicEvent => ({ name, tier: TIER[name], at });

export function staticEvents(): EconomicEvent[] {
  const out: EconomicEvent[] = [];
  for (const name of Object.keys(STATIC_RELEASES) as EventName[]) {
    const { time, dates } = STATIC_RELEASES[name];
    const [hour, minute] = time.split(':').map(Number);
    for (const date of dates) {
      const [y, m, d] = date.split('-').map(Number);
      out.push(makeEvent(name, iso(zonedTimeToUtc(y, m, d, hour, minute, NEW_YORK))));
    }
  }
  return out;
}

/** First Friday of a month at 13:30 UK: the existing news calendar's NFP rule. */
export function firstFridayNfp(year: number, month: number): string {
  const first = zonedParts(new Date(Date.UTC(year, month - 1, 1, 12)), LONDON).weekday;
  const day = 1 + ((5 - first + 7) % 7);
  return iso(zonedTimeToUtc(year, month, day, 13, 30, LONDON));
}

/** Aurum's existing news-calendar source: the config list plus the NFP rule, for
 * every month the static schedule covers. */
export function liveSourceEvents(): EconomicEvent[] {
  const out = NEWS_EVENTS.filter((e): e is typeof e & { name: EventName } => e.name in TIER).map((e) => makeEvent(e.name, iso(new Date(e.at))));
  for (const date of STATIC_RELEASES.NFP.dates) {
    const [y, m] = date.split('-').map(Number);
    out.push(makeEvent('NFP', firstFridayNfp(y, m)));
  }
  return out;
}

const monthKey = (e: EconomicEvent): string => `${e.name}:${e.at.slice(0, 7)}`;

/**
 * Merge the two sources. An official entry wins on both date and time; the other
 * source fills only the months the official schedule has no entry for. Every
 * disagreement is returned for logging.
 *
 * The other source is a committed list plus the first-Friday rule, not a feed. It
 * guesses wrong: BLS moved Jan and Oct 2027 to the second Friday, and 13:30 UK is
 * an hour late in the week the US is still on summer time.
 */
export function mergeSchedules(
  official: EconomicEvent[],
  live: EconomicEvent[],
): { events: EconomicEvent[]; disagreements: CalendarDisagreement[] } {
  const events = new Map(official.map((e) => [monthKey(e), e]));
  const disagreements: CalendarDisagreement[] = [];

  for (const l of live) {
    const key = monthKey(l);
    const s = events.get(key);
    if (!s) {
      events.set(key, l);
      continue;
    }
    if (s.at !== l.at) disagreements.push({ name: l.name, staticAt: s.at, liveAt: l.at, usedAt: s.at });
  }

  return {
    events: [...events.values()].sort((a, b) => a.at.localeCompare(b.at)),
    disagreements,
  };
}

/**
 * True when no event remains after `now`. Quiet weeks are normal, with gaps of up to
 * 23 days between releases, so only a calendar that has run out counts.
 */
export function isCalendarExhausted(events: EconomicEvent[], now: Date): boolean {
  return !events.some((e) => Date.parse(e.at) > now.getTime());
}

export function lastEventAt(events: EconomicEvent[]): string | null {
  return events.reduce<string | null>((max, e) => (!max || e.at > max ? e.at : max), null);
}

/** A warning once the last event is under 60 days away, else null. */
export function calendarExpiryWarning(events: EconomicEvent[], now: Date): string | null {
  const last = lastEventAt(events);
  const daysLeft = last ? (Date.parse(last) - now.getTime()) / DAY_MS : -1;
  if (daysLeft >= CALENDAR_WARNING_DAYS) return null;
  const day = last?.slice(0, 10) ?? 'unknown';
  return daysLeft > 0
    ? `⚠️ Economic calendar: last event is ${day}, ${Math.ceil(daysLeft)} days away. Add the new BLS and Fed dates.`
    : `⚠️ Economic calendar has run out (last event ${day}). Entries are blocked until new dates are added.`;
}

export function effectiveSchedule(): { events: EconomicEvent[]; disagreements: CalendarDisagreement[]; coverageEnd: string } {
  return { ...mergeSchedules(staticEvents(), liveSourceEvents()), coverageEnd: CALENDAR_COVERAGE_END };
}
