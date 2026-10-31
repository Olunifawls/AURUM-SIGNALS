import { summarise } from './forward-test';
import { buildSnapshotPayload, ClosedTrade, formatWeeklyHeadline, SnapshotInput } from './weekly-snapshot';
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

describe('formatWeeklyHeadline', () => {
  const text = formatWeeklyHeadline(buildSnapshotPayload(input()), 'Snapshot');

  it('shows the same numbers as the payload', () => {
    expect(text).toContain('Kept: 1 signals, 1 resolved, 100.0% wins, +1.5R (raw L1 +4.0R)');
    expect(text).toContain('Setups 3, duplicates 1, non-tradeable 1');
    expect(text).toContain('Active halts: FEED_STALE');
    expect(text).toContain('Weeks since v1 start: 3 / 8');
    expect(text).toContain('Demo trades since v1 start: 3 / 30');
  });

  it('stamps the snapshot in London time', () => {
    expect(text).toContain('Snapshot: 29/11/2026 17:00 London');
    expect(formatWeeklyHeadline(buildSnapshotPayload(input({ now: new Date('2026-07-05T16:00:00Z') })), 'Snapshot')).toContain('05/07/2026 17:00 London');
  });
});

describe('WeeklySnapshotService', () => {
  function makeDb(tables: Record<string, any> = {}) {
    const inserted: any[] = [];
    const client = {
      from: (table: string) => {
        const res = tables[table] ?? { data: [], count: 0, error: null };
        const b: any = {
          select: () => b,
          eq: () => b,
          gte: () => b,
          order: () => b,
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
    return { client, inserted };
  }
  const ledger = { report: jest.fn(async () => ({ ruleset: 'v1', newsExitMode: 'SHADOW', recent: [{ signalId: 'x' }], ...report })) } as any;
  const state = { getActiveHalts: jest.fn(async () => [{ halt_type: 'FEED_STALE' }]) } as any;
  const broker = { getAccount: jest.fn(async () => ({ currency: 'GBP', equity: 1900, unrealizedPl: 0 })) } as any;
  const tables = {
    signal_evaluations: { data: [{ evaluated_at: '2026-11-01T22:00:00Z' }], error: null },
    positions: { data: [{ closed_at: '2026-11-25T10:00:00Z', realized_r: '2.00', slippage_points: '0.10' }], count: 1, error: null },
    system_events: { data: null, count: 5, error: null },
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
