import { LedgerRow, NewsExitRow, summarise, WatchRow } from './forward-test';
import { ForwardTestService } from './forward-test.service';

const row = (over: Partial<LedgerRow>): LedgerRow => ({
  signalId: 's',
  timeframe: '4h',
  createdAt: '2026-11-02T04:00:00Z',
  eligible: true,
  agents: [],
  rMultiple: null,
  resolvedAt: null,
  ...over,
});

describe('summarise', () => {
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

describe('ForwardTestService', () => {
  const tables: Record<string, any[]> = {
    signal_evaluations: [
      {
        signal_id: 'sig-1',
        eligible: false,
        ai_summary: null,
        agents: [{ agent: 'dollar', verdict: 'FAIL', hard: true }],
        signals: { timeframe: '4h', created_at: '2026-11-02T04:00:00Z', status: 'HIT_TP', entry_price: 2000, stop_loss: 1990, pips_result: 20, resolved_at: '2026-11-03T01:00:00Z', resolved_price: 2020 },
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
    expect(r.recent[0]).toMatchObject({ signalId: 'sig-1', eligible: false });
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
