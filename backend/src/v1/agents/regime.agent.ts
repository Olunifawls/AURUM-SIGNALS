import { SMA_BARS, SMA_SLOPE_BARS } from '../v1.constants';
import { directionSign, usableBars } from './bars';
import { AgentResult, DailyBar, Direction } from './types';

const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;

/** HARD. XAU/USD daily: price on the trade's side of the 50-bar mean, and that mean
 * sloping the trade's way over ten bars. */
export function regimeAgent(direction: Direction, goldDaily: DailyBar[], now: Date): AgentResult {
  const usable = usableBars('regime', true, 'XAU/USD', goldDaily, SMA_BARS + SMA_SLOPE_BARS, now);
  if ('missing' in usable) return usable.missing;

  const closes = usable.bars.map((b) => b.close);
  const last = usable.bars[usable.bars.length - 1];
  const close = last.close;
  const sma50 = mean(closes.slice(-SMA_BARS));
  const sma50Earlier = mean(closes.slice(-SMA_BARS - SMA_SLOPE_BARS, -SMA_SLOPE_BARS));
  const slope = sma50 - sma50Earlier;
  const dir = directionSign(direction);

  const priceOk = dir * (close - sma50) > 0;
  const slopeOk = dir * slope > 0;
  const side = direction === 'BUY' ? 'above' : 'below';
  const trend = direction === 'BUY' ? 'rising' : 'falling';
  return {
    agent: 'regime',
    verdict: priceOk && slopeOk ? 'PASS' : 'FAIL',
    hard: true,
    inputs: [
      { name: 'close', value: close, ts: last.ts },
      { name: 'sma50', value: sma50, ts: last.ts },
      { name: 'sma50_slope_10', value: slope, ts: last.ts },
    ],
    reasons: [
      `Gold close ${close.toFixed(2)} is ${priceOk ? '' : 'not '}${side} its 50-day mean ${sma50.toFixed(2)}.`,
      `The 50-day mean is ${slopeOk ? '' : 'not '}${trend} (${slope.toFixed(2)} over ten bars).`,
    ],
  };
}
