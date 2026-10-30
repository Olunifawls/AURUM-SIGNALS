import { EconomicEvent } from '../calendar/economic-calendar';
import { CandleRow } from '../../ingestion/oanda-candles.service';
import { dollarShock } from './dollar-shock';
import { dueTier1Event } from './news-exit';
import { NewsExitService } from './news-exit.service';
import { ShadowWatchService } from './shadow-watch.service';

const NFP: EconomicEvent = { name: 'NFP', tier: 1, at: '2026-11-06T13:30:00.000Z' };
const PPI: EconomicEvent = { name: 'PPI', tier: 2, at: '2026-11-13T13:30:00.000Z' };
const FOMC: EconomicEvent = { name: 'FOMC', tier: 1, at: '2026-12-09T19:00:00.000Z' };
const CPI: EconomicEvent = { name: 'CPI', tier: 1, at: '2026-11-10T13:30:00.000Z' };

describe('dueTier1Event', () => {
  const schedule = [NFP, CPI, PPI, FOMC];
  const at = (s: string) => dueTier1Event(schedule, new Date(s))?.name ?? null;

  it('is not due at 16 minutes before', () => {
    expect(at('2026-11-06T13:14:59Z')).toBeNull();
  });
  it('is due at exactly T-15', () => {
    expect(at('2026-11-06T13:15:00Z')).toBe('NFP');
  });
  it('stays due until the release, so a missed tick or a late fill is caught', () => {
    expect(at('2026-11-06T13:29:59Z')).toBe('NFP');
  });
  it('is over at the release itself', () => {
    expect(at('2026-11-06T13:30:00Z')).toBeNull();
  });
  it('covers CPI and FOMC', () => {
    expect(at('2026-11-10T13:15:00Z')).toBe('CPI');
    expect(at('2026-12-09T18:45:00Z')).toBe('FOMC');
  });
  it('ignores PPI', () => {
    expect(at('2026-11-13T13:15:00Z')).toBeNull();
    expect(at('2026-11-13T13:29:00Z')).toBeNull();
  });
});

function makeDb(positions: any[] | null, readError: { message: string } | null = null) {
  const updates: any[] = [];
  const inserts: Record<string, any[]> = {};
  const client = {
    from: (table: string) => ({
      select: () => ({ eq: async () => ({ data: positions, error: readError }) }),
      update: (fields: any) => ({
        eq: async (_c: string, id: string) => {
          updates.push({ id, ...fields });
          return { error: null };
        },
      }),
      insert: async (row: any) => {
        (inserts[table] ??= []).push(row);
        return { error: null };
      },
    }),
  } as any;
  return { client, updates, inserts };
}

function makeBroker(over: any = {}) {
  return {
    closeTrade: jest.fn(async () => ({ closed: true })),
    getTrade: jest.fn(async () => ({ state: 'CLOSED', closePrice: 2005, closeTime: '2026-11-06T13:15:02.000Z', realizedPl: 14 })),
    ...over,
  } as any;
}
const makeAlerts = () => ({ send: jest.fn(async () => true), sendAdminError: jest.fn(async () => true) }) as any;

const position = (over: any = {}) => ({
  id: 'pos-1',
  signal_id: 'sig-1',
  mode: 'demo',
  side: 'BUY',
  entry_price: 2000,
  stop_loss: 2000.1, // a moved stop must not change R
  initial_stop_loss: 1990,
  broker_trade_id: 'T1',
  meta: { keep: 1 },
  ...over,
});

describe('NewsExitService', () => {
  const OLD = { ...process.env };
  const T15 = new Date('2026-11-06T13:15:00Z');
  beforeEach(() => {
    process.env.OANDA_ACCOUNT_ID_DEMO = 'acct';
  });
  afterEach(() => (process.env = { ...OLD }));

  it('closes every open position at T-15 with reason NEWS_EXIT and the event name', async () => {
    const db = makeDb([position(), position({ id: 'pos-2', broker_trade_id: 'T2' })]);
    const broker = makeBroker();
    const n = await new NewsExitService(db.client, broker, makeAlerts()).tick(T15);

    expect(n).toBe(2);
    expect(broker.closeTrade.mock.calls.map((c: any[]) => c[0])).toEqual(['T1', 'T2']);
    expect(db.updates[0]).toMatchObject({
      id: 'pos-1',
      status: 'CLOSED',
      close_reason: 'NEWS_EXIT',
      close_price: 2005,
      closed_at: '2026-11-06T13:15:02.000Z',
      realized_r: 0.5, // +5 on the original 10 risk
      meta: { keep: 1, news_exit: { event: 'NFP', release_at: NFP.at } },
    });
    expect(db.inserts.risk_events[0]).toMatchObject({ event_type: 'NEWS_EXIT', signal_id: 'sig-1' });
    expect(db.inserts.risk_events[0].message).toContain('NFP');
  });

  it('touches nothing outside a tier-1 window', async () => {
    const db = makeDb([position()]);
    const broker = makeBroker();
    expect(await new NewsExitService(db.client, broker, makeAlerts()).tick(new Date('2026-11-06T13:14:00Z'))).toBe(0);
    expect(broker.closeTrade).not.toHaveBeenCalled();
  });

  it('does not close for PPI', async () => {
    const db = makeDb([position()]);
    const broker = makeBroker();
    expect(await new NewsExitService(db.client, broker, makeAlerts()).tick(new Date('2026-11-13T13:15:00Z'))).toBe(0);
    expect(broker.closeTrade).not.toHaveBeenCalled();
  });

  it('a broker failure alerts, leaves that position open for the next tick, and continues', async () => {
    const db = makeDb([position(), position({ id: 'pos-2', broker_trade_id: 'T2' })]);
    const broker = makeBroker({
      closeTrade: jest.fn(async (id: string) => {
        if (id === 'T1') throw new Error('HTTP 503');
        return { closed: true };
      }),
    });
    const alerts = makeAlerts();
    expect(await new NewsExitService(db.client, broker, alerts).tick(T15)).toBe(1);
    expect(db.updates.map((u) => u.id)).toEqual(['pos-2']);
    expect(alerts.sendAdminError).toHaveBeenCalled();
  });

  it('does not record a close the broker did not fill', async () => {
    const db = makeDb([position()]);
    const alerts = makeAlerts();
    await new NewsExitService(db.client, makeBroker({ closeTrade: jest.fn(async () => ({ closed: false })) }), alerts).tick(T15);
    expect(db.updates).toEqual([]);
    expect(alerts.sendAdminError).toHaveBeenCalled();
  });

  it('alerts on a position with no broker trade id', async () => {
    const db = makeDb([position({ broker_trade_id: null })]);
    const alerts = makeAlerts();
    await new NewsExitService(db.client, makeBroker(), alerts).tick(T15);
    expect(alerts.sendAdminError).toHaveBeenCalled();
  });

  it('alerts when open positions cannot be read', async () => {
    const alerts = makeAlerts();
    await new NewsExitService(makeDb(null, { message: 'down' }).client, makeBroker(), alerts).tick(T15);
    expect(alerts.sendAdminError).toHaveBeenCalled();
  });

  it('does nothing without a configured demo account', async () => {
    delete process.env.OANDA_ACCOUNT_ID_DEMO;
    const broker = makeBroker();
    await new NewsExitService(makeDb([position()]).client, broker, makeAlerts()).tick(T15);
    expect(broker.closeTrade).not.toHaveBeenCalled();
  });
});

/** n flat hours with a given high-low width, then a final hour moving to `lastClose`. */
function hours(n: number, width: number, last: { open: number; close: number }, base = 100): CandleRow[] {
  const start = Date.parse('2026-11-02T00:00:00Z');
  const flat = Array.from({ length: n }, (_, i) => ({ ts: new Date(start + i * 3600_000).toISOString(), open: base, high: base * (1 + width), low: base, close: base, volume: 1 }));
  return [...flat, { ts: new Date(start + n * 3600_000).toISOString(), open: last.open, high: Math.max(last.open, last.close), low: Math.min(last.open, last.close), close: last.close, volume: 1 }];
}

describe('dollarShock', () => {
  // EUR flat at 1 with zero width. USD/JPY's 20 prior hours span 100 to 100*e^0.01,
  // so each proxy range is 0.005 exactly.
  const width = Math.exp(0.01) - 1;
  const eur = hours(20, 0, { open: 100, close: 100 });

  it('flags a move against a BUY beyond 1x the average range', () => {
    const jpy = hours(20, width, { open: 100, close: 100 * Math.exp(0.0102) }); // proxy +0.0051
    const s = dollarShock('BUY', eur, jpy);
    expect(s?.averageRange).toBeCloseTo(0.005, 10);
    expect(s?.move).toBeCloseTo(0.0051, 10);
    expect(s?.shock).toBe(true);
  });

  it('does not flag the same move on a SELL, where it helps', () => {
    expect(dollarShock('SELL', eur, hours(20, width, { open: 100, close: 100 * Math.exp(0.0102) }))?.shock).toBe(false);
  });

  it('flags a falling dollar against a SELL', () => {
    expect(dollarShock('SELL', eur, hours(20, width, { open: 100, close: 100 * Math.exp(-0.0102) }))?.shock).toBe(true);
  });

  it('needs strictly more than 1x', () => {
    expect(dollarShock('BUY', eur, hours(20, width, { open: 100, close: 100 * Math.exp(0.0099) }))?.shock).toBe(false);
  });

  it('returns null without 21 shared hours', () => {
    expect(dollarShock('BUY', hours(19, 0, { open: 100, close: 100 }), hours(19, width, { open: 100, close: 100 }))).toBeNull();
  });
});

describe('ShadowWatchService', () => {
  function makeWatch(positions: any[], watchRows: any[] = []) {
    const recorded: any[] = [];
    const chain = (rows: any[]) => {
      const b: any = {
        select: () => b,
        eq: () => b,
        order: () => b,
        limit: async () => ({ data: rows, error: null }),
        then: (r: any) => r({ data: rows, error: null }),
      };
      return b;
    };
    const client = {
      from: (table: string) => {
        if (table === 'positions') return chain(positions);
        if (table === 'candles') return chain([{ close: 1234.5 }]);
        return {
          ...chain(watchRows),
          upsert: async (row: any) => {
            recorded.push(row);
            return { error: null };
          },
        };
      },
    } as any;
    return { client, recorded };
  }

  const DAY = 86_400_000;
  const lastBar = Date.parse('2026-11-04T00:00:00Z');
  const now = new Date('2026-11-05T00:10:00Z');
  const series = (closes: number[]) => closes.map((close, i) => ({ ts: new Date(lastBar - (closes.length - 1 - i) * DAY).toISOString(), close }));
  const up = Array.from({ length: 60 }, (_, i) => 1000 + i * 10);
  const down = [...up].reverse();
  const data = (gold: number[]) =>
    ({
      goldDaily: jest.fn(async () => series(gold)),
      macroDaily: jest.fn(async (i: string) => series(i === 'EUR_USD' ? Array.from({ length: 21 }, (_, n) => 1 + n / 100) : Array.from({ length: 21 }, (_, n) => 150 - n))),
    }) as any;
  const events = () => ({ warn: jest.fn(async () => undefined) }) as any;
  const open = { id: 'pos-1', signal_id: 'sig-1', side: 'BUY', opened_at: '2026-11-03T04:02:00Z' };

  it('logs a flip when an agent turns against the trade, with the price', async () => {
    const { client, recorded } = makeWatch([open]);
    await new ShadowWatchService(client, data(down), {} as any, events()).thesisWatch(now);
    const regime = recorded.find((r) => r.agent === 'regime');
    expect(regime).toMatchObject({ kind: 'THESIS_CHECK', verdict: 'FAIL', flipped: true, price: 1234.5, position_id: 'pos-1' });
    expect(recorded.find((r) => r.agent === 'dollar')).toMatchObject({ verdict: 'PASS', flipped: false });
  });

  it('records a passing check without a flip', async () => {
    const { client, recorded } = makeWatch([open]);
    await new ShadowWatchService(client, data(up), {} as any, events()).thesisWatch(now);
    expect(recorded.every((r) => r.flipped === false)).toBe(true);
  });

  it('does not re-flip an agent already against the trade', async () => {
    const { client, recorded } = makeWatch([open], [{ verdict: 'FAIL', bar_ts: new Date(lastBar - DAY).toISOString() }]);
    await new ShadowWatchService(client, data(down), {} as any, events()).thesisWatch(now);
    expect(recorded.find((r) => r.agent === 'regime')?.flipped).toBe(false);
  });

  it('skips a bar already checked', async () => {
    const { client, recorded } = makeWatch([open], [{ verdict: 'PASS', bar_ts: new Date(lastBar).toISOString() }]);
    await new ShadowWatchService(client, data(down), {} as any, events()).thesisWatch(now);
    expect(recorded).toEqual([]);
  });

  it('skips DATA_MISSING rather than calling it a flip', async () => {
    const { client, recorded } = makeWatch([open]);
    await new ShadowWatchService(client, data(up.slice(0, 10)), {} as any, events()).thesisWatch(now);
    expect(recorded.find((r) => r.agent === 'regime')).toBeUndefined();
  });

  it('reads nothing when no trade is open', async () => {
    const { client } = makeWatch([]);
    const d = data(up);
    await new ShadowWatchService(client, d, {} as any, events()).thesisWatch(now);
    expect(d.goldDaily).not.toHaveBeenCalled();
  });

  it('logs a dollar shock inside the trade, and not one from before it opened', async () => {
    const width = Math.exp(0.01) - 1;
    const eur = hours(20, 0, { open: 100, close: 100 });
    const jpy = hours(20, width, { open: 100, close: 100 * Math.exp(0.0102) });
    const oanda = { fetchInstrument: jest.fn(async (i: string) => (i === 'EUR_USD' ? eur : jpy)) } as any;

    const before = makeWatch([{ ...open, opened_at: '2026-11-02T00:00:00Z' }]);
    await new ShadowWatchService(before.client, {} as any, oanda, events()).dollarShockWatch();
    expect(before.recorded[0]).toMatchObject({ kind: 'DOLLAR_SHOCK', agent: 'dollar', position_id: 'pos-1', price: 1234.5 });

    const after = makeWatch([{ ...open, opened_at: '2026-11-03T00:00:00Z' }]);
    await new ShadowWatchService(after.client, {} as any, oanda, events()).dollarShockWatch();
    expect(after.recorded).toEqual([]);
  });

  it('has no broker, so it cannot act on a trade', () => {
    expect(ShadowWatchService.length).toBe(4);
    const { client } = makeWatch([]);
    expect(Object.values(new ShadowWatchService(client, {} as any, {} as any, events())).some((v: any) => typeof v?.closeTrade === 'function')).toBe(false);
  });

  it('a failure is logged, never thrown', async () => {
    const ev = events();
    const broken = { from: () => { throw new Error('down'); } } as any;
    await new ShadowWatchService(broken, {} as any, {} as any, ev).thesisWatch(now);
    expect(ev.warn).toHaveBeenCalledWith('shadow-watch', 'thesis watch failed', expect.anything());
  });
});
