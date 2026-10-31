import { FiredSignal, lastClosedCandle, LedgerRow, NewsExitRow, nonTradeableReason, quotePrice, summarise, tradeableR, WatchRow } from './forward-test';
import { ForwardTestService } from './forward-test.service';

const row = (over: Partial<LedgerRow>): LedgerRow => ({
  nonTradeable: null,
  tradeableR: over.rMultiple ?? null,
  signalId: 's',
  timeframe: '4h',
  createdAt: '2026-11-02T04:00:00Z',
  eligible: true,
  duplicateOf: null,
  agents: [],
  rMultiple: null,
  resolvedAt: null,
  ...over,
});

describe('summarise', () => {
  it('counts each setup once and reports duplicates separately', () => {
    const verdict = [{ agent: 'sentiment', verdict: 'SUPPORT' }];
    const r = summarise(
      [
        row({ agents: verdict, rMultiple: 2, resolvedAt: '2026-11-03T10:00:00Z' }),
        row({ duplicateOf: 'a', eligible: false, agents: verdict, rMultiple: 2, resolvedAt: '2026-11-03T11:00:00Z' }),
        row({ duplicateOf: 'a', eligible: false, agents: verdict, rMultiple: -1, resolvedAt: '2026-11-03T12:00:00Z' }),
        row({ eligible: false, rMultiple: -1, resolvedAt: '2026-11-03T10:00:00Z' }),
      ],
      [],
      [],
    );
    expect(r.setups).toBe(2);
    expect(r.duplicates).toBe(2);
    expect(r.kept).toMatchObject({ signals: 1, totalR: 2 });
    expect(r.vetoed).toMatchObject({ signals: 1, totalR: -1 });
    expect(r.kept.curve).toEqual([{ day: '2026-11-03', value: 2 }]);
    expect(r.byVerdict).toEqual([{ agent: 'sentiment', verdict: 'SUPPORT', signals: 1, resolved: 1, wins: 1, losses: 0, totalR: 2 }]);
  });

  it('splits kept from vetoed and tracks vetoed signals to outcome', () => {
    const r = summarise(
      [
        row({ rMultiple: 2, resolvedAt: '2026-11-03T10:00:00Z' }),
        row({ rMultiple: -1, resolvedAt: '2026-11-04T10:00:00Z' }),
        row({ eligible: false, rMultiple: -1, resolvedAt: '2026-11-03T10:00:00Z' }),
        row({ eligible: false }),
      ],
      [],
      [],
    );
    expect(r.kept).toMatchObject({ signals: 2, resolved: 2, wins: 1, losses: 1, totalR: 1 });
    expect(r.kept.curve).toEqual([{ day: '2026-11-03', value: 2 }, { day: '2026-11-04', value: 1 }]);
    expect(r.vetoed).toMatchObject({ signals: 2, resolved: 1, totalR: -1 });
  });

  it('sums same-day results into one curve point', () => {
    const r = summarise([row({ rMultiple: 2, resolvedAt: '2026-11-03T01:00:00Z' }), row({ rMultiple: 2, resolvedAt: '2026-11-03T02:00:00Z' })], [], []);
    expect(r.kept.curve).toEqual([{ day: '2026-11-03', value: 4 }]);
  });

  it('gives R by agent verdict', () => {
    const cotS = { agent: 'sentiment', verdict: 'SUPPORT' };
    const cotO = { agent: 'sentiment', verdict: 'OPPOSE' };
    const y = { agent: 'yields10y', verdict: 'SUPPORT' };
    const r = summarise(
      [
        row({ agents: [cotS, y], rMultiple: 2, resolvedAt: '2026-11-03T00:00:00Z' }),
        row({ agents: [cotO, y], rMultiple: -1, resolvedAt: '2026-11-03T00:00:00Z' }),
        row({ agents: [cotO] }),
      ],
      [],
      [],
    );
    expect(r.byVerdict).toEqual([
      { agent: 'sentiment', verdict: 'OPPOSE', signals: 2, resolved: 1, wins: 0, losses: 1, totalR: -1 },
      { agent: 'sentiment', verdict: 'SUPPORT', signals: 1, resolved: 1, wins: 1, losses: 0, totalR: 2 },
      { agent: 'yields10y', verdict: 'SUPPORT', signals: 2, resolved: 2, wins: 1, losses: 1, totalR: 1 },
    ]);
  });

  it('compares a news exit with holding, from the real fill and original stop', () => {
    const exit: NewsExitRow = { positionId: 'p', event: 'CPI', closedAt: 'x', side: 'BUY', entry: 2000, initialStop: 1990, realizedR: 0.5, signalResolvedPrice: 2020 };
    const r = summarise([], [exit, { ...exit, positionId: 'q', signalResolvedPrice: null }], []);
    expect(r.newsExits.trades[0]).toMatchObject({ event: 'CPI', exitR: 0.5, holdR: 2 });
    expect(r.newsExits.trades[1].holdR).toBeNull();
    expect(r.newsExits).toMatchObject({ settled: 1, exitR: 0.5, holdR: 2 });
  });

  it('compares closing at T-15 with holding for shadow news exits, one row per release', () => {
    const w = (over: Partial<WatchRow>): WatchRow => ({ kind: 'NEWS_EXIT_SHADOW', positionId: 'p', agent: 'CPI', flipped: false, barTs: '2026-11-10T13:30:00.000Z', price: 2005, side: 'BUY', entry: 2000, initialStop: 1990, finalR: 2, ...over });
    const r = summarise([], [], [w({}), w({ agent: 'FOMC', barTs: '2026-12-09T19:00:00.000Z', price: 1995 }), w({ positionId: 'q', finalR: null })]);
    expect(r.newsExits.trades).toHaveLength(3);
    expect(r.newsExits.trades[0]).toMatchObject({ event: 'CPI', exitR: 0.5, holdR: 2 });
    expect(r.newsExits.trades[2].holdR).toBeNull();
    expect(r.newsExits).toMatchObject({ settled: 2, exitR: 0, holdR: 4 });
    expect(r.thesisWatch.events).toEqual([]);
    expect(r.dollarShock.events).toEqual([]);
  });

  it('shows R at each shadow event against what the trade made, counting only flips', () => {
    const w = (over: Partial<WatchRow>): WatchRow => ({ kind: 'THESIS_CHECK', positionId: 'p', agent: 'regime', flipped: true, barTs: 'b', price: 2005, side: 'BUY', entry: 2000, initialStop: 1990, finalR: -1, ...over });
    const r = summarise([], [], [w({}), w({ flipped: false }), w({ kind: 'DOLLAR_SHOCK', flipped: false, price: 1995, finalR: 2 }), w({ finalR: null })]);
    expect(r.thesisWatch).toMatchObject({ settled: 1, actedR: 0.5, heldR: -1 });
    expect(r.thesisWatch.events).toHaveLength(2);
    expect(r.dollarShock).toMatchObject({ settled: 1, actedR: -0.5, heldR: 2 });
  });
});

describe('tradeable classification', () => {
  const MAX = 0.1; // 1R is 10 here, so the drift limit is 1.0
  const buy = (firePrice: number | null): FiredSignal => ({ side: 'BUY', entry: 2000, stop: 1990, target: 2020, firePrice });
  const sell = (firePrice: number | null): FiredSignal => ({ side: 'SELL', entry: 2000, stop: 2010, target: 1980, firePrice });

  it('takes a signal at its entry', () => {
    expect(nonTradeableReason(buy(2000), MAX)).toBeNull();
    expect(nonTradeableReason(sell(2000), MAX)).toBeNull();
  });

  it('refuses a price at or past the target', () => {
    expect(nonTradeableReason(buy(2020), MAX)).toBe('PAST_TARGET');
    expect(nonTradeableReason(buy(2031), MAX)).toBe('PAST_TARGET');
    expect(nonTradeableReason(sell(1980), MAX)).toBe('PAST_TARGET');
    expect(nonTradeableReason(sell(1969), MAX)).toBe('PAST_TARGET');
  });

  it('refuses a price at or past the stop', () => {
    expect(nonTradeableReason(buy(1990), MAX)).toBe('PAST_STOP');
    expect(nonTradeableReason(buy(1985), MAX)).toBe('PAST_STOP');
    expect(nonTradeableReason(sell(2010), MAX)).toBe('PAST_STOP');
    expect(nonTradeableReason(sell(2015), MAX)).toBe('PAST_STOP');
  });

  it('refuses adverse drift over the limit and accepts it up to the limit', () => {
    expect(nonTradeableReason(buy(2001.01), MAX)).toBe('ENTRY_DRIFT');
    expect(nonTradeableReason(buy(2001), MAX)).toBeNull();
    expect(nonTradeableReason(sell(1998.99), MAX)).toBe('ENTRY_DRIFT');
    expect(nonTradeableReason(sell(1999), MAX)).toBeNull();
  });

  it('accepts favourable drift of any size short of the stop', () => {
    expect(nonTradeableReason(buy(1991), MAX)).toBeNull();
    expect(nonTradeableReason(sell(2009), MAX)).toBeNull();
  });

  it('treats no fire price as not tradeable', () => {
    expect(nonTradeableReason(buy(null), MAX)).toBe('NO_FIRE_PRICE');
  });
});

describe('tradeable R', () => {
  const buy: FiredSignal = { side: 'BUY', entry: 2000, stop: 1990, target: 2020, firePrice: 2001 };
  const sell: FiredSignal = { side: 'SELL', entry: 2000, stop: 2010, target: 1980, firePrice: 1999 };

  // Original risk is 10 throughout, whatever the fire price.
  it('measures a BUY with an adverse fire in the original unit', () => {
    expect(tradeableR(buy, 2020)).toBe(1.9);
    expect(tradeableR(buy, 1990)).toBe(-1.1);
  });

  it('measures a BUY with a favourable fire in the original unit', () => {
    expect(tradeableR({ ...buy, firePrice: 1995 }, 2020)).toBe(2.5);
    expect(tradeableR({ ...buy, firePrice: 1995 }, 1990)).toBe(-0.5);
  });

  it('measures a SELL with an adverse fire in the original unit', () => {
    expect(tradeableR(sell, 1980)).toBe(1.9);
    expect(tradeableR(sell, 2010)).toBe(-1.1);
  });

  it('measures a SELL with a favourable fire in the original unit', () => {
    expect(tradeableR({ ...sell, firePrice: 2005 }, 1980)).toBe(2.5);
    expect(tradeableR({ ...sell, firePrice: 2005 }, 2010)).toBe(-0.5);
  });

  it('gives the raw R when it fires at the entry', () => {
    expect(tradeableR({ ...buy, firePrice: 2000 }, 2020)).toBe(2);
    expect(tradeableR({ ...sell, firePrice: 2000 }, 2010)).toBe(-1);
  });

  it('does not inflate the replay trade that shrank its unit', () => {
    const s: FiredSignal = { side: 'SELL', entry: 4190.615, stop: 4216.5602, target: 4138.7246, firePrice: 4205.4 };
    expect(tradeableR(s, s.target)).toBe(2.57);
  });

  it('has no R with no risk to measure', () => {
    expect(tradeableR({ ...buy, entry: 1990 }, 2020)).toBeNull();
  });

  it('flows through the summary and agent stats in the original unit', () => {
    const fire = (rMultiple: number, firePrice: number) => {
      const s: FiredSignal = { side: 'BUY', entry: 2000, stop: 1990, target: 2020, firePrice };
      return row({ agents: [{ agent: 'dollar', verdict: 'PASS' }], rMultiple, tradeableR: tradeableR(s, s.target), resolvedAt: '2026-11-03T10:00:00Z' });
    };
    const r = summarise([fire(2, 1995), fire(2, 2001)], [], []);
    expect(r.kept).toMatchObject({ signals: 2, totalR: 4.4 });
    expect(r.kept.raw).toEqual({ signals: 2, totalR: 4 });
    expect(r.byVerdict[0].totalR).toBe(4.4);
  });

  it('is null until resolved or without a fire price', () => {
    expect(tradeableR(buy, null)).toBeNull();
    expect(tradeableR({ ...buy, firePrice: null }, 2020)).toBeNull();
  });
});

describe('fire price', () => {
  it('uses the side of the quote the executor trades', () => {
    expect(quotePrice('BUY', 1999, 2001)).toBe(2001);
    expect(quotePrice('SELL', 1999, 2001)).toBe(1999);
  });

  it('treats an empty quote as no price', () => {
    expect(quotePrice('BUY', 0, 0)).toBeNull();
  });

  it('takes the newest candle finished by that time, never one still forming', () => {
    const candles = [{ ts: '2026-10-30T13:45:00Z', close: '3920' }, { ts: '2026-10-30T14:00:00Z', close: '3905' }];
    expect(lastClosedCandle(candles, '2026-10-30T14:03:06Z')).toBe(3920);
    expect(lastClosedCandle(candles, '2026-10-30T14:15:00Z')).toBe(3905);
    expect(lastClosedCandle(candles, '2026-10-30T13:50:00Z')).toBeNull();
  });
});

describe('summarise, tradeable only', () => {
  const v = [{ agent: 'dollar', verdict: 'PASS' }];
  const when = '2026-11-03T10:00:00Z';
  const r = summarise(
    [
      row({ agents: v, rMultiple: 2, tradeableR: 1.5, resolvedAt: when }),
      row({ agents: v, rMultiple: 2, tradeableR: null, nonTradeable: 'PAST_TARGET', resolvedAt: when }),
      row({ eligible: false, agents: v, rMultiple: -1, tradeableR: -1, resolvedAt: when }),
      row({ eligible: false, rMultiple: 2, tradeableR: 3, nonTradeable: 'ENTRY_DRIFT', resolvedAt: when }),
      row({ duplicateOf: 'a', eligible: false, rMultiple: 2, nonTradeable: 'PAST_TARGET', resolvedAt: when }),
    ],
    [],
    [],
  );

  it('uses tradeable signals and tradeable R in the headline', () => {
    expect(r.kept).toMatchObject({ signals: 1, resolved: 1, wins: 1, totalR: 1.5 });
    expect(r.vetoed).toMatchObject({ signals: 1, resolved: 1, losses: 1, totalR: -1 });
    expect(r.kept.curve).toEqual([{ day: '2026-11-03', value: 1.5 }]);
  });

  it('keeps raw L1 R as a secondary figure, each setup once', () => {
    expect(r.kept.raw).toEqual({ signals: 2, totalR: 4 });
    expect(r.vetoed.raw).toEqual({ signals: 2, totalR: 1 });
  });

  it('counts non-tradeable setups separately, by reason, leaving duplicates out', () => {
    expect(r.nonTradeable).toEqual({ total: 2, byReason: { PAST_TARGET: 1, ENTRY_DRIFT: 1 } });
    expect(r.setups).toBe(4);
    expect(r.duplicates).toBe(1);
  });

  it('gives agent stats on tradeable R only', () => {
    expect(r.byVerdict).toEqual([{ agent: 'dollar', verdict: 'PASS', signals: 2, resolved: 2, wins: 1, losses: 1, totalR: 0.5 }]);
  });
});

describe('ForwardTestService', () => {
  const tables: Record<string, any[]> = {
    signal_evaluations: [
      {
        signal_id: 'sig-1',
        eligible: false,
        fire_price: 2000,
        ai_summary: null,
        agents: [{ agent: 'dollar', verdict: 'FAIL', hard: true }],
        signals: { timeframe: '4h', created_at: '2026-11-02T04:00:00Z', status: 'HIT_TP', direction: 'BUY', entry_price: 2000, stop_loss: 1990, take_profit: 2020, pips_result: 20, resolved_at: '2026-11-03T01:00:00Z', resolved_price: 2020 },
      },
    ],
    positions: [{ id: 'pos-1', signal_id: 'sig-1', side: 'BUY', entry_price: 2000, stop_loss: 1995, initial_stop_loss: 1990, realized_r: 0.5, close_reason: 'NEWS_EXIT', closed_at: 'c', status: 'CLOSED', meta: { news_exit: { event: 'NFP' } } }],
    trade_watch_events: [],
  };
  const client = {
    from: (t: string) => {
      const b: any = { select: () => b, eq: () => b, order: () => b, range: async () => ({ data: tables[t], error: null }) };
      return b;
    },
  } as any;

  it('derives the signal R, keeps a vetoed signal in the ledger, and links the news exit', async () => {
    const r = await new ForwardTestService(client).report();
    expect(r.vetoed).toMatchObject({ signals: 1, resolved: 1, totalR: 2 });
    expect(r.newsExitMode).toBe('SHADOW');
    expect(r.kept.signals).toBe(0);
    expect(r.newsExits.trades[0]).toMatchObject({ event: 'NFP', exitR: 0.5, holdR: 2 });
    expect(r.recent[0]).toMatchObject({ signalId: 'sig-1', eligible: false, duplicateOf: null });
    expect(r).toMatchObject({ setups: 1, duplicates: 0, nonTradeable: { total: 0 } });
  });

  it('measures from the stored fire price and refuses one past the target', async () => {
    const row = tables.signal_evaluations[0];
    const withFire = (fire_price: number | null) => ({ ...client, from: (t: string) => {
      const data = t === 'signal_evaluations' ? [{ ...row, fire_price }] : tables[t];
      const b: any = { select: () => b, eq: () => b, order: () => b, range: async () => ({ data, error: null }) };
      return b;
    } });
    const near = await new ForwardTestService(withFire(2001) as any).report();
    expect(near.vetoed).toMatchObject({ signals: 1, resolved: 1, totalR: 1.9 });
    expect(near.vetoed.raw).toEqual({ signals: 1, totalR: 2 });

    const past = await new ForwardTestService(withFire(2025) as any).report();
    expect(past.vetoed.signals).toBe(0);
    expect(past.vetoed.raw).toEqual({ signals: 1, totalR: 2 });
    expect(past.nonTradeable).toEqual({ total: 1, byReason: { PAST_TARGET: 1 } });
    expect(past.recent[0]).toMatchObject({ nonTradeable: 'PAST_TARGET', firePrice: 2025 });
    expect(past.byVerdict).toEqual([]);

    const none = await new ForwardTestService(withFire(null) as any).report();
    expect(none.nonTradeable.byReason).toEqual({ NO_FIRE_PRICE: 1 });
  });

  it('leaves R blank for a position with no recorded stop', async () => {
    const rows: Record<string, any[]> = {
      signal_evaluations: [],
      positions: [{ id: 'pos-9', side: 'BUY', entry_price: 2000, stop_loss: null, initial_stop_loss: null, status: 'OPEN' }],
      trade_watch_events: [{ kind: 'NEWS_EXIT_SHADOW', position_id: 'pos-9', agent: 'CPI', flipped: false, bar_ts: 'b', price: 2005 }],
    };
    const db = { from: (t: string) => { const b: any = { select: () => b, eq: () => b, order: () => b, range: async () => ({ data: rows[t], error: null }) }; return b; } } as any;
    expect((await new ForwardTestService(db).report()).newsExits.trades[0].exitR).toBeNull();
  });

  it('pages past the 1000-row cap', async () => {
    const calls: number[] = [];
    const paged = {
      from: (t: string) => {
        const b: any = {
          select: () => b, eq: () => b, order: () => b,
          range: async (from: number) => {
            if (t === 'trade_watch_events') calls.push(from);
            const rows = t === 'trade_watch_events' && from === 0 ? new Array(1000).fill({ kind: 'DOLLAR_SHOCK', position_id: null, agent: 'dollar', flipped: false, bar_ts: 'b', price: null }) : [];
            return { data: rows, error: null };
          },
        };
        return b;
      },
    } as any;
    await new ForwardTestService(paged).report();
    expect(calls).toEqual([0, 1000]);
  });

  it('throws on a query error, like the other read services', async () => {
    const bad = { from: () => { const b: any = { select: () => b, eq: () => b, order: () => b, range: async () => ({ data: null, error: { message: 'no table' } }) }; return b; } } as any;
    await expect(new ForwardTestService(bad).report()).rejects.toThrow('query failed');
  });
});
