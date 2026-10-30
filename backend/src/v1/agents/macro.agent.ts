import { DOLLAR_MOMENTUM_BARS, YIELD_CHANGE_BARS } from '../v1.constants';
import { directionSign, usableBars } from './bars';
import { AgentName, AgentResult, DailyBar, Direction } from './types';

/** Dollar proxy: (ln(USDJPY) - ln(EURUSD)) / 2. */
export function dollarProxy(usdJpy: number, eurUsd: number): number {
  return (Math.log(usdJpy) - Math.log(eurUsd)) / 2;
}

/** The proxy on every timestamp both pairs share. */
function proxySeries(eurUsd: DailyBar[], usdJpy: DailyBar[]): DailyBar[] {
  const jpyByTs = new Map(usdJpy.map((b) => [Date.parse(b.ts), b.close]));
  const out: DailyBar[] = [];
  for (const e of eurUsd) {
    const jpy = jpyByTs.get(Date.parse(e.ts));
    if (jpy !== undefined) out.push({ ts: e.ts, close: dollarProxy(jpy, e.close) });
  }
  return out;
}

/** HARD veto: the dollar must have fallen over 20 bars for a BUY, risen for a SELL. */
export function dollarAgent(direction: Direction, eurUsd: DailyBar[], usdJpy: DailyBar[], now: Date): AgentResult {
  const usable = usableBars('dollar', true, 'EUR_USD/USD_JPY', proxySeries(eurUsd, usdJpy), DOLLAR_MOMENTUM_BARS + 1, now);
  if ('missing' in usable) return usable.missing;

  const bars = usable.bars;
  const last = bars[bars.length - 1];
  const earlier = bars[bars.length - 1 - DOLLAR_MOMENTUM_BARS];
  const usdM20 = last.close - earlier.close;
  const pass = directionSign(direction) * -usdM20 > 0;
  const moved = usdM20 > 0 ? 'risen' : usdM20 < 0 ? 'fallen' : 'not moved';
  return {
    agent: 'dollar',
    verdict: pass ? 'PASS' : 'FAIL',
    hard: true,
    inputs: [
      { name: 'usd', value: last.close, ts: last.ts },
      { name: 'usd_20_bars_earlier', value: earlier.close, ts: earlier.ts },
      { name: 'usd_m20', value: usdM20, ts: last.ts },
    ],
    reasons: [`The dollar proxy has ${moved} over 20 bars (${usdM20.toFixed(5)}), which ${pass ? 'allows' : 'vetoes'} a gold ${direction}.`],
  };
}

/** SHADOW: 20-bar change of a T-note PRICE. Notes move opposite to yields, so a rising
 * price means falling yields, the textbook support for a gold BUY. Evidence only. */
export function yieldAgent(
  agent: Extract<AgentName, 'yields10y' | 'yields2y'>,
  direction: Direction,
  notePrices: DailyBar[],
  now: Date,
): AgentResult {
  const label = agent === 'yields10y' ? 'USB10Y_USD' : 'USB02Y_USD';
  const usable = usableBars(agent, false, label, notePrices, YIELD_CHANGE_BARS + 1, now);
  if ('missing' in usable) return usable.missing;

  const bars = usable.bars;
  const last = bars[bars.length - 1];
  const earlier = bars[bars.length - 1 - YIELD_CHANGE_BARS];
  const change = last.close - earlier.close;
  const aligned = directionSign(direction) * change;
  const yields = change > 0 ? 'falling' : change < 0 ? 'rising' : 'flat';
  return {
    agent,
    verdict: aligned > 0 ? 'SUPPORT' : aligned < 0 ? 'OPPOSE' : 'NEUTRAL',
    hard: false,
    inputs: [
      { name: 'note_price', value: last.close, ts: last.ts },
      { name: 'note_price_20_bars_earlier', value: earlier.close, ts: earlier.ts },
      { name: 'change_20', value: change, ts: last.ts },
    ],
    reasons: [`${label} changed ${change.toFixed(3)} over 20 bars, so yields are ${yields}.`],
  };
}
