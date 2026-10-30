import { EconomicEvent } from '../calendar/economic-calendar';
import { NEWS_EXIT_LEAD_MIN } from '../v1.constants';

/** The tier-1 release in its exit window: from 15 minutes before until it prints.
 * The window, rather than one exact minute, survives a missed cron tick and also
 * catches a position that fills after T-15. PPI is tier 2 and never exits. */
export function dueTier1Event(schedule: EconomicEvent[], now: Date): EconomicEvent | null {
  const t = now.getTime();
  return schedule.find((e) => e.tier === 1 && t >= Date.parse(e.at) - NEWS_EXIT_LEAD_MIN * 60_000 && t < Date.parse(e.at)) ?? null;
}
