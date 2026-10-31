import { summarise } from './forward-test';
import { buildSnapshotPayload, ClosedTrade, formatWeeklyHeadline, HaltEvent, HaltRow, haltsThisWeek, SnapshotInput, WeekHalt } from './weekly-snapshot';
import { WeeklySnapshotService } from './weekly-snapshot.service';

const NOW = new Date('2026-11-29T17:00:00Z');
const when = '2026-11-24T10:00:00Z';
const row = (over: any) => ({ signalId: 's', timeframe: '4h', createdAt: when, eligible: true, duplicateOf: null, agents: [], rMultiple: null, nonTradeable: null, tradeableR: null, resolvedAt: when, ...over });

const report = summarise(
  [
    row({ agents: [{ agent: 'dollar', verdict: 'PASS' }], rMultiple: 2, tradeableR: 1.5 }),
    row({ rMultiple: 2, nonTradeable: 'PAST_TARGET' }),
    row({ eligible: false, rMultiple: -1, tradeableR: -1 }),
    row({ duplicateOf: 'a', eligible: false, rMultiple: 2 }),
  ],
  [],
  [],
);
const trade = (closedAt: string, realizedR: number | null, slippagePoints: number | null): ClosedTrade => ({ closedAt, realizedR, slippagePoints });
const input = (over: Partial<SnapshotInput> = {}): SnapshotInput => ({
  now: NOW,
  ruleset: 'v1',
  report,
  trades: [trade('2026-11-25T10:00:00Z', 2, 0.1), trade('2026-11-26T10:00:00Z', -1, 0.3), trade('2026-11-10T10:00:00Z', 1, 0.2)],
  activeHalts: ['FEED_STALE'],
  haltsThisWeek: [],
  errorsThisWeek: 2,
  v1StartedAt: '2026-11-01T22:00:00Z',
  lastCalendarEvent: '2026-12-29T17:00:00Z',
  account: { ccy: 'GBP', equity: 1900, startOfWeekEquity: 1950, highWaterMark: 2000, openPositions: 1 },
  ...over,
});

describe('buildSnapshotPayload', () => {
  const p = buildSnapshotPayload(input());

  it('takes kept and vetoed straight from the ledger: tradeable, each setup once', () => {
    expect(p.kept).toEqual({ count: 1, resolved: 1, winRatePct: 100, totalR: 1.5 });
    expect(p.vetoed).toEqual({ count: 1, resolved: 1, winRatePct: 0, totalR: -1 });
    expect(p.raw.kept).toEqual(report.kept.raw);
    expect(p.setups).toBe(report.setups);
    expect(p.duplicates).toBe(1);
    expect(p.nonTradeable).toEqual(report.nonTradeable);
    expect(p.byVerdict).toEqual([{ agent: 'dollar', verdict: 'PASS', resolved: 1, totalR: 1.5 }]);
  });

  it('splits real fills into this week and since v1', () => {
    expect(p.demoTrades.thisWeek).toEqual({ count: 2, winRatePct: 50, totalR: 1, avgSlippagePoints: 0.2 });
    expect(p.demoTrades.sinceV1).toEqual({ count: 3, winRatePct: 66.7, totalR: 2, avgSlippagePoints: 0.2 });
  });

  it('copes with no trades', () => {
    const empty = buildSnapshotPayload(input({ trades: [] })).demoTrades.thisWeek;
    expect(empty).toEqual({ count: 0, winRatePct: null, totalR: 0, avgSlippagePoints: null });
  });

  it('reports gate progress in whole weeks since the v1 start', () => {
    expect(p.gate).toEqual({ weeksSinceV1: 3, weeksRequired: 8, demoTrades: 3, demoTradesRequired: 30 });
    expect(buildSnapshotPayload(input({ v1StartedAt: null })).gate.weeksSinceV1).toBe(0);
  });

  it('carries the health fields', () => {
    expect(p.activeHalts).toEqual(['FEED_STALE']);
    expect(p.errorsThisWeek).toBe(2);
    expect(p.calendarDaysLeft).toBe(30);
    expect(p.account.maxDrawdownPct).toBe(5);
  });

  it('is plain JSON, so the row reads back identical', () => {
    expect(JSON.parse(JSON.stringify(p))).toEqual(p);
  });
});

describe('haltsThisWeek', () => {
  const WEEK = new Date('2026-11-22T17:00:00Z');
  const fired = (type: string, created_at: string, reason = 'tripped'): HaltEvent => ({ created_at, message: `${type}: ${reason}`, meta: { haltType: type } });
  const row = (over: Partial<HaltRow>): HaltRow => ({ halt_type: 'FEED_STALE', reason: 'feed stale', active: false, triggered_at: '2026-11-24T10:00:00.000Z', cleared_at: '2026-11-24T11:00:00.000Z', ...over });

  it('gives the type, reason, set time and clear time of an activation', () => {
    const h = haltsThisWeek([fired('VOLATILITY_COOLDOWN', '2026-11-24T10:00:00.200Z', 'range spike')], [row({ halt_type: 'VOLATILITY_COOLDOWN' })], WEEK);
    expect(h).toEqual([{ type: 'VOLATILITY_COOLDOWN', reason: 'range spike', setAt: '2026-11-24T10:00:00.200Z', clearedAt: '2026-11-24T11:00:00.000Z', status: 'CLEARED', timesLogged: 1 }]);
  });

  it('ignores the order rejections that share the event type', () => {
    const rejection: HaltEvent = { created_at: '2026-11-24T10:00:00Z', message: 'an active halt flag is set', meta: null };
    expect(haltsThisWeek([rejection, rejection], [], WEEK)).toEqual([]);
  });

  it('merges a breaker re-firing every cycle into one activation', () => {
    const logs = [0, 3, 6, 9].map((m) => fired('CONSECUTIVE_SL', `2026-11-24T10:0${m}:00.000Z`));
    const h = haltsThisWeek(logs, [row({ halt_type: 'CONSECUTIVE_SL', active: true, cleared_at: null, triggered_at: '2026-11-24T10:09:00.000Z' })], WEEK);
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ setAt: '2026-11-24T10:00:00.000Z', status: 'ACTIVE', clearedAt: null, timesLogged: 4 });
  });

  it('says so when an earlier firing of a type has no clear time left', () => {
    const h = haltsThisWeek(
      [fired('FEED_STALE', '2026-11-23T10:00:00.000Z'), fired('FEED_STALE', '2026-11-24T10:00:00.000Z')],
      [row({})],
      WEEK,
    );
    expect(h.map((x) => x.status)).toEqual(['CLEAR_TIME_UNKNOWN', 'CLEARED']);
    expect(h[0].clearedAt).toBeNull();
  });

  it('includes a manual halt, which logs no event', () => {
    const h = haltsThisWeek([], [row({ halt_type: 'MANUAL_HALT', reason: 'manual /halt', active: true, cleared_at: null })], WEEK);
    expect(h).toEqual([{ type: 'MANUAL_HALT', reason: 'manual /halt', setAt: '2026-11-24T10:00:00.000Z', clearedAt: null, status: 'ACTIVE', timesLogged: 1 }]);
  });

  it('includes a halt from before the week that was cleared or is still active in it', () => {
    const old = '2026-09-11T15:00:00.000Z';
    const h = haltsThisWeek([], [row({ halt_type: 'MANUAL_HALT', triggered_at: old }), row({ halt_type: 'DRAWDOWN', triggered_at: old, active: true, cleared_at: null })], WEEK);
    expect(h.map((x) => [x.type, x.status])).toEqual([['MANUAL_HALT', 'CLEARED'], ['DRAWDOWN', 'ACTIVE']]);
  });

  it('leaves out a halt over before the week began', () => {
    expect(haltsThisWeek([], [row({ triggered_at: '2026-11-01T10:00:00Z', cleared_at: '2026-11-02T10:00:00Z' })], WEEK)).toEqual([]);
    expect(haltsThisWeek([fired('FEED_STALE', '2026-11-20T10:00:00Z')], [], WEEK)).toEqual([]);
  });

  it('sorts by set time', () => {
    const h = haltsThisWeek([fired('DAILY_LOSS', '2026-11-25T10:00:00Z')], [row({ halt_type: 'MANUAL_HALT' })], WEEK);
    expect(h.map((x) => x.type)).toEqual(['MANUAL_HALT', 'DAILY_LOSS']);
  });
});

describe('formatWeeklyHeadline', () => {
  const text = formatWeeklyHeadline(buildSnapshotPayload(input()), 'Snapshot');

  it('shows the same numbers as the payload', () => {
    expect(text).toContain('Kept: 1 signals, 1 resolved, 100.0% wins, +1.5R (raw L1 +4.0R)');
    expect(text).toContain('Setups 3, duplicates 1, non-tradeable 1');
    expect(text).toContain('Active halts: FEED_STALE');
    expect(text).toContain('Weeks since v1 start: 3 / 8');
    expect(text).toContain('Demo trades since v1 start: 3 / 30');
  });

  const halt = (over: Partial<WeekHalt> = {}): WeekHalt => ({ type: 'FEED_STALE', reason: 'no candles for 25 min', setAt: '2026-11-24T10:00:00Z', clearedAt: '2026-11-24T11:30:00Z', status: 'CLEARED', timesLogged: 1, ...over });
  const render = (haltsThisWeek: WeekHalt[]) => formatWeeklyHeadline(buildSnapshotPayload(input({ haltsThisWeek })), 'Snapshot');

  it('lists each halt with its reason, set time and clear time', () => {
    const out = render([halt(), halt({ type: 'MANUAL_HALT', reason: 'manual /halt', status: 'ACTIVE', clearedAt: null }), halt({ status: 'CLEAR_TIME_UNKNOWN', clearedAt: null })]);
    expect(out).toContain('FEED_STALE: no candles for 25 min\n  set 24/11/2026 10:00 London, cleared 24/11/2026 11:30 London');
    expect(out).toContain('MANUAL_HALT: manual /halt\n  set 24/11/2026 10:00 London, still active');
    expect(out).toContain('clear time not recorded');
  });

  it('says None for a quiet week', () => {
    expect(render([])).toContain('━━ Halts and kill switches this week ━━\nNone');
  });

  it('caps the Telegram list, and the snapshot keeps them all', () => {
    const many = Array.from({ length: 13 }, () => halt());
    expect(render(many)).toContain('…and 3 more, in the snapshot');
    expect(buildSnapshotPayload(input({ haltsThisWeek: many })).haltsThisWeek).toHaveLength(13);
  });

  it('reads a snapshot written before this field existed', () => {
    const old: any = buildSnapshotPayload(input());
    delete old.haltsThisWeek;
    expect(formatWeeklyHeadline(old, 'Snapshot')).toContain('Not recorded in this snapshot');
  });

  it('stamps the snapshot in London time', () => {
    expect(text).toContain('Snapshot: 29/11/2026 17:00 London');
    expect(formatWeeklyHeadline(buildSnapshotPayload(input({ now: new Date('2026-07-05T16:00:00Z') })), 'Snapshot')).toContain('05/07/2026 17:00 London');
  });
});

describe('WeeklySnapshotService', () => {
  function makeDb(tables: Record<string, any> = {}) {
    const inserted: any[] = [];
    const filters: unknown[][] = [];
    const client = {
      from: (table: string) => {
        const res = tables[table] ?? { data: [], count: 0, error: null };
        const b: any = {
          select: () => b,
          eq: () => b,
          gte: () => b,
          not: (...args: unknown[]) => {
            filters.push(args);
            return b;
          },
          order: () => b,
          range: () => Promise.resolve(res),
          limit: () => Promise.resolve(res),
          insert: (row: any) => {
            inserted.push({ table, row });
            return { select: () => ({ single: async () => ({ data: { created_at: '2026-11-29T17:00:01Z' }, error: tables.insertError ?? null }) }) };
          },
          then: (r: any) => Promise.resolve(res).then(r),
        };
        return b;
      },
    } as any;
    return { client, inserted, filters };
  }
  const ledger = { report: jest.fn(async () => ({ ruleset: 'v1', newsExitMode: 'SHADOW', recent: [{ signalId: 'x' }], ...report })) } as any;
  const state = { getActiveHalts: jest.fn(async () => [{ halt_type: 'FEED_STALE' }]) } as any;
  const broker = { getAccount: jest.fn(async () => ({ currency: 'GBP', equity: 1900, unrealizedPl: 0 })) } as any;
  const tables = {
    signal_evaluations: { data: [{ evaluated_at: '2026-11-01T22:00:00Z' }], error: null },
    positions: { data: [{ closed_at: '2026-11-25T10:00:00Z', realized_r: '2.00', slippage_points: '0.10' }], count: 1, error: null },
    system_events: { data: null, count: 5, error: null },
    risk_events: { data: [{ created_at: '2026-11-25T10:00:00.100Z', message: 'FEED_STALE: no candles', meta: { haltType: 'FEED_STALE' } }], error: null },
    system_halts: { data: [{ halt_type: 'FEED_STALE', reason: 'no candles', active: false, triggered_at: '2026-11-25T10:00:00.000Z', cleared_at: '2026-11-25T11:00:00.000Z' }], error: null },
  };

  it('writes exactly one row, with the ledger numbers, and returns that payload', async () => {
    const db = makeDb(tables);
    const out = await new WeeklySnapshotService(db.client, broker, ledger, state).write(NOW);
    expect(db.inserted).toHaveLength(1);
    expect(db.inserted[0]).toMatchObject({ table: 'weekly_snapshots', row: { ruleset: 'v1' } });
    expect(db.inserted[0].row.payload).toBe(out.payload);
    expect(out.payload.kept).toEqual({ count: 1, resolved: 1, winRatePct: 100, totalR: 1.5 });
    expect(out.payload.demoTrades.sinceV1.totalR).toBe(2);
    expect(out.payload.errorsThisWeek).toBe(5);
    expect(out.payload.activeHalts).toEqual(['FEED_STALE']);
    expect(out.payload.v1StartedAt).toBe('2026-11-01T22:00:00Z');
    expect(out.payload).not.toHaveProperty('recent');
  });

  it('puts the halts of the week in the payload, asking for activations only', async () => {
    const db = makeDb(tables);
    const out = await new WeeklySnapshotService(db.client, broker, ledger, state).write(NOW);
    expect(out.payload.haltsThisWeek).toEqual([{ type: 'FEED_STALE', reason: 'no candles', setAt: '2026-11-25T10:00:00.100Z', clearedAt: '2026-11-25T11:00:00.000Z', status: 'CLEARED', timesLogged: 1 }]);
    expect(db.filters).toEqual([['meta->>haltType', 'is', null]]);
  });

  it('writes nothing if the halts cannot be read', async () => {
    const db = makeDb({ ...tables, system_halts: { data: null, error: { message: 'down' } } });
    await expect(new WeeklySnapshotService(db.client, broker, ledger, state).write(NOW)).rejects.toThrow('system_halts query failed');
    expect(db.inserted).toHaveLength(0);
  });

  it('still writes if the broker is down', async () => {
    const db = makeDb(tables);
    const down = { getAccount: jest.fn(async () => { throw new Error('down'); }) } as any;
    const out = await new WeeklySnapshotService(db.client, down, ledger, state).write(NOW);
    expect(out.payload.account.equity).toBeNull();
    expect(db.inserted).toHaveLength(1);
  });

  it('writes nothing if a query fails, rather than a snapshot with gaps', async () => {
    const db = makeDb({ ...tables, positions: { data: null, count: null, error: { message: 'down' } } });
    await expect(new WeeklySnapshotService(db.client, broker, ledger, state).write(NOW)).rejects.toThrow('positions query failed');
    expect(db.inserted).toHaveLength(0);
  });

  it('reads back the latest row', async () => {
    const db = makeDb({ weekly_snapshots: { data: [{ created_at: 'x', payload: { kept: 1 } }], error: null } });
    expect(await new WeeklySnapshotService(db.client, broker, ledger, state).latest()).toEqual({ createdAt: 'x', payload: { kept: 1 } });
  });

  it('has nothing to read before the first row', async () => {
    const db = makeDb();
    expect(await new WeeklySnapshotService(db.client, broker, ledger, state).latest()).toBeNull();
  });
});
