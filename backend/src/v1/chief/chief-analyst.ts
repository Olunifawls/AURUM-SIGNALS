import { dollarAgent, yieldAgent } from '../agents/macro.agent';
import { newsAgent } from '../agents/news.agent';
import { regimeAgent } from '../agents/regime.agent';
import { sentimentAgent } from '../agents/sentiment.agent';
import { technicalAgent } from '../agents/technical.agent';
import { AgentInput, AgentName, AgentResult, CotReport, DailyBar, Direction } from '../agents/types';
import { EconomicEvent } from '../calendar/economic-calendar';
import { RULESET_VERSION } from '../v1.constants';

export interface SignalToEvaluate {
  timeframe: string;
  direction: Direction;
  entry: number;
  stop: number;
  target: number;
  createdAt: string;
}

/** Everything the agents read. An empty list means the data could not be loaded. */
export interface AgentData {
  goldDaily: DailyBar[];
  eurUsd: DailyBar[];
  usdJpy: DailyBar[];
  note10y: DailyBar[];
  note2y: DailyBar[];
  cot: CotReport[];
  schedule: EconomicEvent[];
  calendarEnd: string;
}

export interface EvidencePack {
  ruleset: string;
  evaluatedAt: string;
  signal: SignalToEvaluate;
  eligible: boolean;
  caseFor: string[];
  caseAgainst: string[];
  noted: string[];
  invalidationLevel: number;
  target: number;
  eventRisk: AgentInput[];
  dataTimestamps: Partial<Record<AgentName, string | null>>;
  ineligibleReason?: 'DUPLICATE';
  duplicateOf?: string;
  duplicateOfAt?: string;
}

export interface Evaluation {
  ruleset: string;
  eligible: boolean;
  agents: AgentResult[];
  evidence: EvidencePack;
  duplicateOf: string | null;
  duplicateOfAt: string | null;
}

/** Eligible only if every HARD agent says PASS. FAIL and DATA_MISSING both block. */
export function isEligible(agents: AgentResult[]): boolean {
  const hard = agents.filter((a) => a.hard);
  return hard.length > 0 && hard.every((a) => a.verdict === 'PASS');
}

function latestInputTs(a: AgentResult): string | null {
  return a.inputs.reduce<string | null>((max, i) => (i.ts && (!max || i.ts > max) ? i.ts : max), null);
}

function buildPack(signal: SignalToEvaluate, agents: AgentResult[], eligible: boolean, now: Date): EvidencePack {
  const lines = (...verdicts: string[]): string[] =>
    agents.filter((a) => verdicts.includes(a.verdict)).flatMap((a) => a.reasons.map((r) => `${a.agent}: ${r}`));
  return {
    ruleset: RULESET_VERSION,
    evaluatedAt: now.toISOString(),
    signal,
    eligible,
    caseFor: lines('PASS', 'SUPPORT'),
    caseAgainst: lines('FAIL', 'OPPOSE'),
    noted: lines('NEUTRAL', 'DATA_MISSING'),
    invalidationLevel: signal.stop,
    target: signal.target,
    eventRisk: agents.find((a) => a.agent === 'news')?.inputs ?? [],
    dataTimestamps: Object.fromEntries(agents.map((a) => [a.agent, latestInputTs(a)])),
  };
}

/** Runs every agent over one L1 signal. Pure: same inputs, same evaluation. */
export function evaluateSignal(signal: SignalToEvaluate, data: AgentData, now: Date): Evaluation {
  const d = signal.direction;
  const agents: AgentResult[] = [
    technicalAgent(signal.timeframe, signal.createdAt),
    regimeAgent(d, data.goldDaily, now),
    dollarAgent(d, data.eurUsd, data.usdJpy, now),
    yieldAgent('yields10y', d, data.note10y, now),
    yieldAgent('yields2y', d, data.note2y, now),
    sentimentAgent(d, data.cot, now),
    newsAgent(data.schedule, data.calendarEnd, now),
  ];
  const eligible = isEligible(agents);
  return { ruleset: RULESET_VERSION, eligible, agents, evidence: buildPack(signal, agents, eligible, now), duplicateOf: null, duplicateOfAt: null };
}

/** A repeat of an earlier setup is never eligible. A data-integrity check, not a rule:
 * every agent's verdict stands as evaluated. */
export function markDuplicate(evaluation: Evaluation, originalId: string, originalAt: string): Evaluation {
  return {
    ...evaluation,
    eligible: false,
    duplicateOf: originalId,
    duplicateOfAt: originalAt,
    evidence: {
      ...evaluation.evidence,
      eligible: false,
      ineligibleReason: 'DUPLICATE',
      duplicateOf: originalId,
      duplicateOfAt: originalAt,
      caseAgainst: [`DUPLICATE: same setup as signal ${originalId}`, ...evaluation.evidence.caseAgainst],
    },
  };
}
