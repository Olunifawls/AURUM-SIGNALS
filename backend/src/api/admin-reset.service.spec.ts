import * as fs from 'fs';
import * as path from 'path';
import { AdminResetService } from './admin-reset.service';

const LEDGER_TABLES = ['risk_events', 'signal_path_metrics', 'equity_snapshots', 'positions', 'orders', 'signals', 'performance_daily'];

const makeBroker = (opts: {
  openTrades?: any[];
  openTradesAfterClose?: any[];
  closeErr?: Error;
  equity?: number;
  balance?: number;
  currency?: string;
} = {}) => {
  const first = opts.openTrades ?? [];
  const second = opts.openTradesAfterClose ?? [];
  let calls = 0;
  return {
    getOpenTrades: jest.fn().mockImplementation(() => Promise.resolve(calls++ === 0 ? first : second)),
    closeTrade: jest.fn().mockImplementation(() =>
      opts.closeErr ? Promise.reject(opts.closeErr) : Promise.resolve({ closed: true }),
    ),
    getAccount: jest.fn().mockResolvedValue({
      equity: opts.equity ?? 10000,
      balance: opts.balance ?? 10000,
      currency: opts.currency ?? 'GBP',
      unrealizedPl: 0, marginUsed: 0, openTradeCount: 0,
      lastTransactionId: '999', id: 'demo',
    }),
  };
};

/** Build a minimal Supabase mock for AdminResetService. */
function makeSupabase(opts: {
  countPerTable?: number;
  haltRows?: any[];
  testPositions?: any[];
  archiveMissing?: boolean;
  rpcErr?: string;
} = {}) {
  const count = opts.countPerTable ?? 0;
  const haltRows = opts.haltRows ?? [];
  const wiped = Object.fromEntries(LEDGER_TABLES.map((t) => [t, count]));

  const del = jest.fn();
  const fromImpl = (table: string) => ({
    select: jest.fn().mockImplementation(() => {
      if (table === 'ledger_archive') {
        return Promise.resolve({ count: 0, error: opts.archiveMissing ? { message: 'relation does not exist' } : null });
      }
      if (table === 'system_halts') {
        // .select('halt_type').eq('active', true) → { data: haltRows }
        return { eq: jest.fn().mockResolvedValue({ data: haltRows }) };
      }
      if (table === 'broker_accounts') {
        // .select('id').eq().eq().limit() → { data: [{id}] }
        return { eq: jest.fn().mockReturnThis(), limit: jest.fn().mockResolvedValue({ data: [{ id: 'ba-uuid' }] }) };
      }
      if (table === 'positions') {
        // .select('id,order_id').or().eq() → { data: testPositions }
        return { or: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ data: opts.testPositions ?? [] }) }) };
      }
      return Promise.resolve({ count, data: null, error: null });
    }),
    delete: del,
    update: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ error: null }) }),
    insert: jest.fn().mockResolvedValue({ error: null }),
  });

  return {
    from: jest.fn().mockImplementation(fromImpl),
    del,
    rpc: jest.fn().mockImplementation((fn: string) =>
      Promise.resolve(
        opts.rpcErr
          ? { data: null, error: { message: opts.rpcErr } }
          : { data: fn === 'archive_and_wipe_ledger' ? wiped : { positions: 1, orders: 1 }, error: null },
      ),
    ),
  };
}

describe('AdminResetService', () => {
  it('happy path: closes 1 trade, archives then wipes the ledger, re-baselines equity', async () => {
    const trade = { id: 'trade-1', side: 'SELL' as const, units: 5, instrument: 'XAU_USD', price: 4100, unrealizedPl: -200 };
    const broker = makeBroker({ openTrades: [trade], openTradesAfterClose: [], equity: 10000 });
    const supabase = makeSupabase({ countPerTable: 63 });
    const svc = new AdminResetService(supabase as any, broker as any);

    const result = await svc.ledgerReset();

    expect(broker.closeTrade).toHaveBeenCalledWith('trade-1');
    expect(broker.getOpenTrades).toHaveBeenCalledTimes(2); // before + verify
    expect(result.flattenedTrades).toBe(1);
    expect(result.openTradesAfter).toBe(0);
    for (const t of LEDGER_TABLES) {
      expect(result.wipedCounts[t]).toBe(63);
    }
    expect(result.baselineEquity).toBe(10000);
    expect(result.baselineCcy).toBe('GBP');
    // insert should be called for equity_snapshots baseline
    const insertedTable = supabase.from.mock.calls.find((c: string[]) => c[0] === 'equity_snapshots');
    expect(insertedTable).toBeDefined();
  });

  it('no open trades: skips closeTrade, still wipes and baselines', async () => {
    const broker = makeBroker({ openTrades: [], openTradesAfterClose: [] });
    const svc = new AdminResetService(makeSupabase() as any, broker as any);
    const result = await svc.ledgerReset();
    expect(broker.closeTrade).not.toHaveBeenCalled();
    expect(result.flattenedTrades).toBe(0);
  });

  it('aborts if closeTrade throws', async () => {
    const trade = { id: 'tx', side: 'SELL' as const, units: 1, instrument: 'XAU_USD', price: 0, unrealizedPl: 0 };
    const broker = makeBroker({ openTrades: [trade], closeErr: new Error('OANDA timeout') });
    const svc = new AdminResetService(makeSupabase() as any, broker as any);
    await expect(svc.ledgerReset()).rejects.toThrow('Failed to close trade tx');
  });

  it('aborts if account is not flat after close', async () => {
    const ghost = { id: 'ghost', side: 'BUY' as const, units: 1, instrument: 'XAU_USD', price: 0, unrealizedPl: 0 };
    const broker = makeBroker({ openTrades: [ghost], openTradesAfterClose: [ghost] });
    const svc = new AdminResetService(makeSupabase() as any, broker as any);
    await expect(svc.ledgerReset()).rejects.toThrow('not flat after close');
  });

  it('archives through the atomic function and never deletes a table directly', async () => {
    const broker = makeBroker();
    const supabase = makeSupabase();
    await new AdminResetService(supabase as any, broker as any).ledgerReset();
    expect(supabase.rpc).toHaveBeenCalledWith('archive_and_wipe_ledger', { p_reason: 'ledger-reset' });
    expect(supabase.del).not.toHaveBeenCalled();
  });

  it('aborts if archiving fails, before re-baselining equity', async () => {
    const broker = makeBroker({ openTrades: [], openTradesAfterClose: [] });
    const supabase = makeSupabase({ rpcErr: 'permission denied' });
    const svc = new AdminResetService(supabase as any, broker as any);
    await expect(svc.ledgerReset()).rejects.toThrow('Archive failed: permission denied');
    expect(supabase.from.mock.calls.find((c: string[]) => c[0] === 'equity_snapshots')).toBeUndefined();
  });

  it('refuses before closing any trade if the archive migration is not applied', async () => {
    const trade = { id: 'trade-1', side: 'SELL' as const, units: 5, instrument: 'XAU_USD', price: 4100, unrealizedPl: 0 };
    const broker = makeBroker({ openTrades: [trade] });
    const svc = new AdminResetService(makeSupabase({ archiveMissing: true }) as any, broker as any);
    await expect(svc.ledgerReset()).rejects.toThrow('0010_ledger_archive');
    expect(broker.closeTrade).not.toHaveBeenCalled();
    expect(broker.getOpenTrades).not.toHaveBeenCalled();
  });

  it('purge archives the test rows through the atomic function and never deletes directly', async () => {
    const supabase = makeSupabase({ testPositions: [{ id: 'p1', order_id: 'o1' }] });
    const result = await new AdminResetService(supabase as any, makeBroker() as any).purgeTestArtifacts();
    expect(supabase.rpc).toHaveBeenCalledWith('archive_test_artifacts', {
      p_reason: 'purge-test-artifacts',
      p_position_ids: ['p1'],
      p_order_ids: ['o1'],
    });
    expect(supabase.del).not.toHaveBeenCalled();
    expect(result).toMatchObject({ positions: 1, orders: 1 });
  });

  it('purge refuses if the archive migration is not applied', async () => {
    const supabase = makeSupabase({ archiveMissing: true });
    const svc = new AdminResetService(supabase as any, makeBroker() as any);
    await expect(svc.purgeTestArtifacts()).rejects.toThrow('0010_ledger_archive');
    expect(supabase.rpc).not.toHaveBeenCalled();
  });
});

describe('migration 0010_ledger_archive.sql', () => {
  const file = path.resolve(__dirname, '../../../supabase/migrations/0010_ledger_archive.sql');
  const sql = () => fs.readFileSync(file, 'utf8');

  it('archives every ledger table before each delete, in both functions', () => {
    const fns = sql().split(/create or replace function/i).slice(1);
    expect(fns).toHaveLength(2);
    for (const fn of fns) {
      const deletes = [...fn.matchAll(/delete from (\w+)/gi)].map((m) => m[1]);
      expect(deletes.length).toBeGreaterThan(0);
      for (const table of deletes) {
        const archived = fn.indexOf(`'${table}'`);
        expect(archived).toBeGreaterThan(-1);
        expect(archived).toBeLessThan(fn.search(new RegExp(`delete from ${table}\\b`, 'i')));
      }
    }
    expect([...sql().matchAll(/delete from (\w+)/gi)].map((m) => m[1])).toEqual(expect.arrayContaining(LEDGER_TABLES));
  });

  it('removes the old unarchived reset and locks the functions to service_role', () => {
    expect(sql()).toMatch(/drop function if exists reset_demo_ledger/i);
    expect(sql()).toMatch(/revoke all on function archive_and_wipe_ledger\(text\) from public, anon, authenticated/i);
    expect(sql()).toMatch(/revoke all on function archive_test_artifacts\(text, uuid\[\], uuid\[\]\) from public, anon, authenticated/i);
    expect(sql()).toMatch(/revoke all on ledger_archive from anon, authenticated/i);
  });
});
