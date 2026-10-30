import {
  COT_CHANGE_REPORTS,
  COT_SUPPORT_BUY_MIN,
  COT_SUPPORT_SELL_MAX,
  COT_USABLE_AFTER_MS,
  COT_WINDOW_REPORTS,
} from '../v1.constants';
import { dataMissing } from './bars';
import { AgentResult, CotReport, Direction } from './types';

/** When a report may first be used: report_date + 3 days 21:00 UTC. */
export function cotUsableAt(reportDate: string): number {
  return Date.parse(`${reportDate}T00:00:00Z`) + COT_USABLE_AFTER_MS;
}

/** SHADOW. Managed-money positioning as a 52-week index, against the trade direction. */
export function sentimentAgent(direction: Direction, reports: CotReport[], now: Date): AgentResult {
  const usable = reports
    .filter((r) => cotUsableAt(r.reportDate) <= now.getTime())
    .sort((a, b) => a.reportDate.localeCompare(b.reportDate));
  const needed = Math.max(COT_WINDOW_REPORTS, COT_CHANGE_REPORTS + 1);
  if (usable.length < needed) {
    return dataMissing('sentiment', false, `COT: ${usable.length} usable reports, ${needed} needed`);
  }

  const nets = usable.map((r) => r.managedMoneyLong - r.managedMoneyShort);
  const net = nets[nets.length - 1];
  const window = nets.slice(-COT_WINDOW_REPORTS);
  const min52 = Math.min(...window);
  const max52 = Math.max(...window);
  if (max52 === min52) return dataMissing('sentiment', false, 'COT: 52-week range is zero, so the index is undefined');

  const index = ((net - min52) / (max52 - min52)) * 100;
  const chg4 = net - nets[nets.length - 1 - COT_CHANGE_REPORTS];
  const support = (direction === 'BUY' && index >= COT_SUPPORT_BUY_MIN) || (direction === 'SELL' && index <= COT_SUPPORT_SELL_MAX);
  const reportDate = usable[usable.length - 1].reportDate;
  const flow = chg4 > 0 ? 'rising' : chg4 < 0 ? 'falling' : 'flat';
  return {
    agent: 'sentiment',
    verdict: support ? 'SUPPORT' : 'OPPOSE',
    hard: false,
    inputs: [
      { name: 'managed_money_net', value: net, ts: reportDate },
      { name: 'index_52w', value: index, ts: reportDate },
      { name: 'net_change_4_reports', value: chg4, ts: reportDate },
    ],
    reasons: [`Managed-money net ${net} sits at ${index.toFixed(1)} on its 52-week index, and is ${flow} over 4 reports (${chg4}).`],
  };
}
