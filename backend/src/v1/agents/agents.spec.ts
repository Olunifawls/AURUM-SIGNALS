import { completeBars, isStale } from './bars';
import { dollarAgent, dollarProxy, yieldAgent } from './macro.agent';
import { newsAgent } from './news.agent';
import { regimeAgent } from './regime.agent';
import { cotUsableAt, sentimentAgent } from './sentiment.agent';
import { technicalAgent } from './technical.agent';
import { CotReport, DailyBar } from './types';

const DAY = 86_400_000;
const START = Date.parse('2026-01-01T00:00:00Z');

/** Daily bars from a list of closes, one per calendar day. */
const series = (closes: number[]): DailyBar[] =>
  closes.map((close, i) => ({ ts: new Date(START + i * DAY).toISOString(), close }));

/** The moment the last of n bars completes. */
const doneAt = (n: number): Date => new Date(START + n * DAY);

const range = (from: number, to: number): number[] => {
  const step = from <= to ? 1 : -1;
  const out: number[] = [];
  for (let v = from; step > 0 ? v <= to : v >= to; v += step) out.push(v);
  return out;
};

describe('bar helpers', () => {
  it('counts a daily bar only once ts + 1 day has passed', () => {
    const bars = series([1, 2]);
    expect(completeBars(bars, new Date(START + 2 * DAY - 1))).toHaveLength(1);
    expect(completeBars(bars, new Date(START + 2 * DAY))).toHaveLength(2);
  });

  it('sorts oldest first whatever order the rows arrive in', () => {
    const bars = series([1, 2, 3]).reverse();
    expect(completeBars(bars, doneAt(3)).map((b) => b.close)).toEqual([1, 2, 3]);
  });

  it('is stale strictly beyond 4 days', () => {
    const ts = new Date(START).toISOString();
    expect(isStale(ts, new Date(START + 4 * DAY))).toBe(false);
    expect(isStale(ts, new Date(START + 4 * DAY + 1))).toBe(true);
  });
});

describe('technical agent', () => {
  const ts = '2026-07-13T04:00:00Z';
  it('passes 4h', () => {
    expect(technicalAgent('4h', ts)).toMatchObject({ agent: 'technical', verdict: 'PASS', hard: true });
  });
  it.each(['15min', '1h', '1day'])('fails %s', (tf) => {
    expect(technicalAgent(tf, ts).verdict).toBe('FAIL');
  });
});

describe('regime agent', () => {
  // closes 1..60: sma50 = mean(11..60) = 35.5, ten bars earlier mean(1..50) = 25.5, slope +10.
  const rising = series(range(1, 60));
  // closes 60..1: sma50 = mean(50..1) = 25.5, ten bars earlier mean(60..11) = 35.5, slope -10.
  const falling = series(range(60, 1));
  const now = doneAt(60);

  it('hand-computes close, sma50 and slope', () => {
    const r = regimeAgent('BUY', rising, now);
    const by = Object.fromEntries(r.inputs.map((i) => [i.name, i.value]));
    expect(by).toEqual({ close: 60, sma50: 35.5, sma50_slope_10: 10 });
  });

  it('BUY passes above a rising mean, SELL fails', () => {
    expect(regimeAgent('BUY', rising, now)).toMatchObject({ verdict: 'PASS', hard: true });
    expect(regimeAgent('SELL', rising, now).verdict).toBe('FAIL');
  });

  it('SELL passes below a falling mean, BUY fails', () => {
    expect(regimeAgent('SELL', falling, now).verdict).toBe('PASS');
    expect(regimeAgent('BUY', falling, now).verdict).toBe('FAIL');
  });

  it('fails when price is on the right side but the slope is not', () => {
    // 60..2 then a spike to 100: sma50 = (sum(2..50) + 100)/50 = 27.48, earlier 35.5, slope -8.02.
    const r = regimeAgent('BUY', series([...range(60, 2), 100]), now);
    expect(r.inputs.find((i) => i.name === 'sma50')?.value).toBeCloseTo(27.48, 10);
    expect(r.inputs.find((i) => i.name === 'sma50_slope_10')?.value).toBeCloseTo(-8.02, 10);
    expect(r.verdict).toBe('FAIL');
  });

  it('fails when the slope is right but price is on the wrong side', () => {
    // 1..59 then a collapse to 1: sma50 = (sum(11..59) + 1)/50 = 34.32, earlier 25.5, slope +8.82.
    const r = regimeAgent('BUY', series([...range(1, 59), 1]), now);
    expect(r.inputs.find((i) => i.name === 'sma50_slope_10')?.value).toBeCloseTo(8.82, 10);
    expect(r.verdict).toBe('FAIL');
  });

  it('zero edge: flat prices fail both directions', () => {
    const flat = series(new Array(60).fill(100));
    expect(regimeAgent('BUY', flat, now).verdict).toBe('FAIL');
    expect(regimeAgent('SELL', flat, now).verdict).toBe('FAIL');
  });

  it('missing data: 59 bars is DATA_MISSING and stays hard', () => {
    expect(regimeAgent('BUY', series(range(1, 59)), doneAt(59))).toMatchObject({ verdict: 'DATA_MISSING', hard: true });
    expect(regimeAgent('BUY', [], now).verdict).toBe('DATA_MISSING');
  });

  it('stale data: latest bar older than 4 days is DATA_MISSING', () => {
    const lastTs = START + 59 * DAY;
    expect(regimeAgent('BUY', rising, new Date(lastTs + 4 * DAY)).verdict).toBe('PASS');
    expect(regimeAgent('BUY', rising, new Date(lastTs + 4 * DAY + 1))).toMatchObject({ verdict: 'DATA_MISSING', hard: true });
  });

  it('excludes the still-forming bar', () => {
    // The 61st bar would flip the verdict if it counted, and has not finished.
    const forming = series([...range(1, 60), 1]);
    expect(regimeAgent('BUY', forming, new Date(START + 61 * DAY - 1)).inputs[0].value).toBe(60);
    expect(regimeAgent('BUY', forming, new Date(START + 61 * DAY - 1)).verdict).toBe('PASS');
    expect(regimeAgent('BUY', forming, doneAt(61)).verdict).toBe('FAIL');
  });
});

describe('dollar agent', () => {
  const flatEur = series(new Array(21).fill(1));
  const jpyUp = series(range(100, 120).map((v) => v)); // 100 -> 120
  const jpyDown = series(range(120, 100));
  const now = doneAt(21);

  it('hand-computes the proxy', () => {
    expect(dollarProxy(Math.E, 1)).toBeCloseTo(0.5, 12);
    expect(dollarProxy(1, Math.E)).toBeCloseTo(-0.5, 12);
  });

  it('dollar up over 20 bars: SELL passes, BUY fails', () => {
    const buy = dollarAgent('BUY', flatEur, jpyUp, now);
    // usd_m20 = (ln 120 - ln 100) / 2 = ln(1.2) / 2 = 0.09116...
    expect(buy.inputs.find((i) => i.name === 'usd_m20')?.value).toBeCloseTo(Math.log(1.2) / 2, 12);
    expect(buy).toMatchObject({ verdict: 'FAIL', hard: true });
    expect(dollarAgent('SELL', flatEur, jpyUp, now).verdict).toBe('PASS');
  });

  it('dollar down over 20 bars: BUY passes, SELL fails', () => {
    expect(dollarAgent('BUY', flatEur, jpyDown, now).verdict).toBe('PASS');
    expect(dollarAgent('SELL', flatEur, jpyDown, now).verdict).toBe('FAIL');
  });

  it('counts EUR strength as dollar weakness', () => {
    const jpyFlat = series(new Array(21).fill(100));
    const eurUp = series(range(100, 120).map((v) => v / 100));
    expect(dollarAgent('BUY', eurUp, jpyFlat, now).verdict).toBe('PASS');
  });

  it('zero edge: no change fails both directions', () => {
    const jpyFlat = series(new Array(21).fill(100));
    expect(dollarAgent('BUY', flatEur, jpyFlat, now).verdict).toBe('FAIL');
    expect(dollarAgent('SELL', flatEur, jpyFlat, now).verdict).toBe('FAIL');
  });

  it('missing data: 20 bars, or one pair absent, is DATA_MISSING', () => {
    expect(dollarAgent('BUY', flatEur.slice(0, 20), jpyUp.slice(0, 20), doneAt(20))).toMatchObject({ verdict: 'DATA_MISSING', hard: true });
    expect(dollarAgent('BUY', flatEur, [], now).verdict).toBe('DATA_MISSING');
  });

  it('counts only timestamps both pairs share', () => {
    expect(dollarAgent('BUY', flatEur, jpyDown.slice(1), now).verdict).toBe('DATA_MISSING');
  });

  it('stale data is DATA_MISSING', () => {
    expect(dollarAgent('BUY', flatEur, jpyDown, new Date(START + 20 * DAY + 4 * DAY + 1))).toMatchObject({ verdict: 'DATA_MISSING', hard: true });
  });

  it('excludes the still-forming bar', () => {
    // A 22nd bar with USDJPY at 200 would flip BUY to FAIL if it counted.
    const eur = series(new Array(22).fill(1));
    const jpy = series([...range(120, 100), 200]);
    expect(dollarAgent('BUY', eur, jpy, new Date(START + 22 * DAY - 1)).verdict).toBe('PASS');
    expect(dollarAgent('BUY', eur, jpy, doneAt(22)).verdict).toBe('FAIL');
  });
});

describe('yield agent (shadow)', () => {
  const up = series(range(100, 120)); // note prices up, yields down
  const down = series(range(120, 100));
  const now = doneAt(21);

  it('rising note prices (falling yields) SUPPORT a BUY and OPPOSE a SELL', () => {
    expect(yieldAgent('yields10y', 'BUY', up, now)).toMatchObject({ verdict: 'SUPPORT', hard: false });
    expect(yieldAgent('yields10y', 'SELL', up, now).verdict).toBe('OPPOSE');
  });

  it('falling note prices (rising yields) OPPOSE a BUY and SUPPORT a SELL', () => {
    expect(yieldAgent('yields2y', 'BUY', down, now).verdict).toBe('OPPOSE');
    expect(yieldAgent('yields2y', 'SELL', down, now).verdict).toBe('SUPPORT');
  });

  it('hand-computes the 20-bar change', () => {
    expect(yieldAgent('yields10y', 'BUY', up, now).inputs.find((i) => i.name === 'change_20')?.value).toBe(20);
  });

  it('zero edge is NEUTRAL', () => {
    expect(yieldAgent('yields10y', 'BUY', series(new Array(21).fill(100)), now).verdict).toBe('NEUTRAL');
  });

  it('missing and stale data are DATA_MISSING and do not become hard', () => {
    expect(yieldAgent('yields10y', 'BUY', up.slice(0, 20), doneAt(20))).toMatchObject({ verdict: 'DATA_MISSING', hard: false });
    expect(yieldAgent('yields10y', 'BUY', up, new Date(START + 24 * DAY + 1))).toMatchObject({ verdict: 'DATA_MISSING', hard: false });
  });

  it('excludes the still-forming bar', () => {
    const forming = series([...range(100, 120), 1]);
    expect(yieldAgent('yields10y', 'BUY', forming, new Date(START + 22 * DAY - 1)).verdict).toBe('SUPPORT');
  });
});

describe('sentiment agent (shadow)', () => {
  const TUE = Date.parse('2025-01-07T00:00:00Z');
  /** Reports with a given net each, one per week; short is fixed at 1000. */
  const reports = (nets: number[]): CotReport[] =>
    nets.map((net, i) => ({
      reportDate: new Date(TUE + i * 7 * DAY).toISOString().slice(0, 10),
      managedMoneyLong: 1000 + net,
      managedMoneyShort: 1000,
    }));
  const usableAfter = (rs: CotReport[]): Date => new Date(cotUsableAt(rs[rs.length - 1].reportDate));
  // 52 reports spanning 0..100 with a chosen latest net, so the index equals that net.
  const withLatest = (latest: number): CotReport[] => reports([0, 100, ...new Array(49).fill(50), latest]);

  it('is usable from report date + 3 days 21:00 UTC', () => {
    expect(new Date(cotUsableAt('2026-10-27')).toISOString()).toBe('2026-10-30T21:00:00.000Z');
  });

  it('BUY: SUPPORT at index 60 and above, OPPOSE below', () => {
    const at60 = withLatest(60);
    expect(sentimentAgent('BUY', at60, usableAfter(at60))).toMatchObject({ verdict: 'SUPPORT', hard: false });
    const at59 = withLatest(59);
    expect(sentimentAgent('BUY', at59, usableAfter(at59)).verdict).toBe('OPPOSE');
  });

  it('SELL: SUPPORT at index 40 and below, OPPOSE above', () => {
    const at40 = withLatest(40);
    expect(sentimentAgent('SELL', at40, usableAfter(at40)).verdict).toBe('SUPPORT');
    const at41 = withLatest(41);
    expect(sentimentAgent('SELL', at41, usableAfter(at41)).verdict).toBe('OPPOSE');
  });

  it('hand-computes net, index and the 4-report change', () => {
    const rs = reports([...new Array(47).fill(0), 10, 20, 30, 40, 200]); // min 0, max 200, net 200
    const r = sentimentAgent('BUY', rs, usableAfter(rs));
    const by = Object.fromEntries(r.inputs.map((i) => [i.name, i.value]));
    expect(by).toEqual({ managed_money_net: 200, index_52w: 100, net_change_4_reports: 190 });
    expect(r.reasons[0]).toContain('rising');
  });

  it('uses only the last 52 reports for the range', () => {
    const rs = reports([1000, ...new Array(50).fill(0), 100, 50]); // the 1000 is 53rd back
    expect(sentimentAgent('BUY', rs, usableAfter(rs)).inputs.find((i) => i.name === 'index_52w')?.value).toBe(50);
  });

  it('excludes a report that is not yet usable', () => {
    const rs = withLatest(90);
    const before = new Date(cotUsableAt(rs[rs.length - 1].reportDate) - 1);
    expect(sentimentAgent('BUY', rs, before)).toMatchObject({ verdict: 'DATA_MISSING', hard: false });
    const more = reports([0, 100, ...new Array(50).fill(50), 90]);
    const justBefore = new Date(cotUsableAt(more[more.length - 1].reportDate) - 1);
    expect(sentimentAgent('BUY', more, justBefore).inputs[0].value).toBe(50);
  });

  it('missing data: fewer than 52 reports', () => {
    const rs = reports(new Array(51).fill(1));
    expect(sentimentAgent('BUY', rs, usableAfter(rs)).verdict).toBe('DATA_MISSING');
  });

  it('zero edge: a flat 52-week range has no index', () => {
    const rs = reports(new Array(52).fill(5));
    expect(sentimentAgent('BUY', rs, usableAfter(rs)).verdict).toBe('DATA_MISSING');
  });
});

describe('news agent (shadow)', () => {
  const events = [
    { name: 'CPI' as const, tier: 1 as const, at: '2026-11-10T13:30:00.000Z' },
    { name: 'PPI' as const, tier: 2 as const, at: '2026-11-13T13:30:00.000Z' },
  ];
  const end = '2027-12-31T23:59:59Z';

  it('reports tier-1 and tier-2 events inside 72 hours, and never blocks', () => {
    const r = newsAgent(events, end, new Date('2026-11-10T14:00:00Z'));
    expect(r).toMatchObject({ agent: 'news', verdict: 'NEUTRAL', hard: false });
    expect(r.inputs.map((i) => i.value)).toEqual(['PPI']);
  });

  it('includes an event exactly 72 hours out and excludes one just beyond', () => {
    expect(newsAgent(events, end, new Date('2026-11-07T13:30:00Z')).inputs.map((i) => i.value)).toEqual(['CPI']);
    expect(newsAgent(events, end, new Date('2026-11-07T13:29:59Z')).inputs).toEqual([]);
  });

  it('excludes an event already released', () => {
    expect(newsAgent(events, end, new Date('2026-11-13T13:30:00Z')).inputs).toEqual([]);
  });

  it('says so when nothing is due', () => {
    expect(newsAgent(events, end, new Date('2026-11-01T00:00:00Z')).reasons[0]).toContain('No tier-1');
  });

  it('is DATA_MISSING when the horizon runs past the calendar', () => {
    expect(newsAgent(events, end, new Date('2027-12-30T00:00:00Z'))).toMatchObject({ verdict: 'DATA_MISSING', hard: false });
  });
});
