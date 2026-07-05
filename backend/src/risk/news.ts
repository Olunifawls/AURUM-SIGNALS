import { NEWS_EVENTS } from './news-events';

/**
 * Pluggable high-impact USD news calendar (check 4, roadmap D8). A live API impl
 * could be added later; with no API key we use the deterministic FALLBACK
 * (`degraded = true`): monthly NFP (first Friday 13:30 UK) + a committed config
 * list of FOMC/CPI dates. Blackout = 30 min before to 30 min after an event.
 */
export const BLACKOUT_MINUTES = 30;

export interface NewsCalendar {
  readonly source: string;
  readonly degraded: boolean;
  isInBlackout(now: Date): { blackout: boolean; event?: string };
}

const WEEKDAY: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** UK-local calendar parts (DST-correct via the tz database). */
export function ukLocalParts(d: Date): { day: number; hour: number; minute: number; weekday: number } {
  const f = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hour12: false,
  });
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  return {
    day: Number(p.day),
    hour: Number(p.hour) % 24,
    minute: Number(p.minute),
    weekday: WEEKDAY[p.weekday as string] ?? -1,
  };
}

/** NFP: first Friday of the month, 13:30 UK; blackout window 13:00–14:00 UK. */
export function isNfpBlackout(now: Date): boolean {
  const uk = ukLocalParts(now);
  const isFirstFriday = uk.weekday === 5 && uk.day <= 7;
  if (!isFirstFriday) return false;
  const mins = uk.hour * 60 + uk.minute;
  return mins >= 13 * 60 - BLACKOUT_MINUTES && mins <= 13 * 60 + 30 + BLACKOUT_MINUTES;
}

export class FallbackNewsCalendar implements NewsCalendar {
  readonly source = 'fallback';
  readonly degraded = true; // no live API key -> coverage is degraded
  private readonly events = NEWS_EVENTS;

  isInBlackout(now: Date): { blackout: boolean; event?: string } {
    if (isNfpBlackout(now)) return { blackout: true, event: 'NFP' };
    const nowMs = now.getTime();
    for (const e of this.events) {
      const diff = Math.abs(nowMs - Date.parse(e.at));
      if (diff <= BLACKOUT_MINUTES * 60_000) return { blackout: true, event: e.name };
    }
    return { blackout: false };
  }
}
