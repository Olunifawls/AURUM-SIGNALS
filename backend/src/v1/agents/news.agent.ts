import { EVENT_RISK_HOURS, HOUR_MS } from '../v1.constants';
import { EconomicEvent } from '../calendar/economic-calendar';
import { dataMissing } from './bars';
import { AgentResult } from './types';

/** SHADOW. Lists tier-1 and tier-2 events in the next 72 hours as event risk. */
export function newsAgent(schedule: EconomicEvent[], coverageEnd: string, now: Date): AgentResult {
  const horizon = now.getTime() + EVENT_RISK_HOURS * HOUR_MS;
  if (horizon > Date.parse(coverageEnd)) {
    return dataMissing('news', false, `The economic calendar ends ${coverageEnd}, before the 72-hour horizon.`);
  }
  const upcoming = schedule.filter((e) => {
    const at = Date.parse(e.at);
    return at > now.getTime() && at <= horizon;
  });
  return {
    agent: 'news',
    verdict: 'NEUTRAL',
    hard: false,
    inputs: upcoming.map((e) => ({ name: `${e.name} (tier ${e.tier})`, value: e.name, ts: e.at })),
    reasons: upcoming.length
      ? upcoming.map((e) => `${e.name} (tier ${e.tier}) is due at ${e.at}.`)
      : ['No tier-1 or tier-2 event in the next 72 hours.'],
  };
}
