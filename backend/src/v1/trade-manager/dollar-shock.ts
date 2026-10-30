import { CandleRow } from '../../ingestion/oanda-candles.service';
import { directionSign } from '../agents/bars';
import { dollarProxy } from '../agents/macro.agent';
import { Direction } from '../agents/types';
import { DOLLAR_SHOCK_RANGE_BARS } from '../v1.constants';

export interface DollarShock {
  shock: boolean;
  barTs: string;
  move: number;
  averageRange: number;
}

/**
 * The dollar proxy's latest complete hour against its 20 prior hours. The proxy's
 * hourly high pairs USD/JPY's high with EUR/USD's low, and its low the reverse, the
 * widest the proxy could have been. Returns null without 21 shared hours.
 */
export function dollarShock(direction: Direction, eurUsd: CandleRow[], usdJpy: CandleRow[]): DollarShock | null {
  const jpyByTs = new Map(usdJpy.map((c) => [Date.parse(c.ts), c]));
  const hours = eurUsd
    .flatMap((e) => {
      const j = jpyByTs.get(Date.parse(e.ts));
      if (!j) return [];
      const high = dollarProxy(j.high, e.low);
      const low = dollarProxy(j.low, e.high);
      return [{ ts: e.ts, move: dollarProxy(j.close, e.close) - dollarProxy(j.open, e.open), range: high - low }];
    })
    .sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
  if (hours.length < DOLLAR_SHOCK_RANGE_BARS + 1) return null;

  const latest = hours[hours.length - 1];
  const prior = hours.slice(-DOLLAR_SHOCK_RANGE_BARS - 1, -1);
  const averageRange = prior.reduce((a, h) => a + h.range, 0) / prior.length;
  // A rising dollar is against a gold BUY.
  return { shock: directionSign(direction) * latest.move > averageRange, barTs: latest.ts, move: latest.move, averageRange };
}
