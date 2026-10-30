export type Direction = 'BUY' | 'SELL';

export type Verdict = 'PASS' | 'FAIL' | 'SUPPORT' | 'OPPOSE' | 'NEUTRAL' | 'DATA_MISSING';

export type AgentName = 'technical' | 'regime' | 'dollar' | 'yields10y' | 'yields2y' | 'sentiment' | 'news';

export interface AgentInput {
  name: string;
  value: number | string | null;
  ts: string | null;
}

/** The one structure every agent returns. */
export interface AgentResult {
  agent: AgentName;
  verdict: Verdict;
  hard: boolean;
  inputs: AgentInput[];
  reasons: string[];
}

/** One daily bar (OANDA D, dailyAlignment=0). ts is the bar's open. */
export interface DailyBar {
  ts: string;
  close: number;
}

/** One CFTC disaggregated futures-only report for gold. */
export interface CotReport {
  reportDate: string; // YYYY-MM-DD, a Tuesday
  managedMoneyLong: number;
  managedMoneyShort: number;
}
