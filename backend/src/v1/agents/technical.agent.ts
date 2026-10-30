import { EXECUTABLE_TIMEFRAME } from '../v1.constants';
import { AgentResult } from './types';

/** HARD: only 4h signals may execute. 15min and 1h are recorded, never executed. */
export function technicalAgent(timeframe: string, signalTs: string): AgentResult {
  const pass = timeframe === EXECUTABLE_TIMEFRAME;
  return {
    agent: 'technical',
    verdict: pass ? 'PASS' : 'FAIL',
    hard: true,
    inputs: [{ name: 'timeframe', value: timeframe, ts: signalTs }],
    reasons: [pass ? 'L1 fired on 4h, the only timeframe eligible for execution.' : `L1 fired on ${timeframe}. Only 4h signals are eligible for execution.`],
  };
}
