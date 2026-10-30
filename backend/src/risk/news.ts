import { EconomicEvent, effectiveSchedule, isCalendarExhausted } from '../v1/calendar/economic-calendar';

/**
 * Pluggable high-impact USD news calendar (check 4, roadmap D8). A live API impl
 * could be added later; with no API key we use the deterministic FALLBACK
 * (`degraded = true`): the v1 economic calendar (NFP, CPI, FOMC, PPI). Blackout =
 * 30 min before to 30 min after an event.
 */
export const BLACKOUT_MINUTES = 30;

export interface NewsCalendar {
  readonly source: string;
  readonly degraded: boolean;
  isInBlackout(now: Date): { blackout: boolean; event?: string };
  /** True when the calendar has run out, so a clear blackout check means nothing. */
  isExhausted(now: Date): boolean;
}

export class FallbackNewsCalendar implements NewsCalendar {
  readonly source = 'fallback';
  readonly degraded = true; // no live API key -> coverage is degraded

  constructor(private readonly events: EconomicEvent[] = effectiveSchedule().events) {}

  isInBlackout(now: Date): { blackout: boolean; event?: string } {
    const nowMs = now.getTime();
    for (const e of this.events) {
      const diff = Math.abs(nowMs - Date.parse(e.at));
      if (diff <= BLACKOUT_MINUTES * 60_000) return { blackout: true, event: e.name };
    }
    return { blackout: false };
  }

  isExhausted(now: Date): boolean {
    return isCalendarExhausted(this.events, now);
  }
}
