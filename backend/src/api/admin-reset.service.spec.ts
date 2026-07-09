import { AdminResetService } from './admin-reset.service';

const LEDGER_TABLES = ['risk_events', 'equity_snapshots', 'positions', 'orders', 'signals', 'performance_daily'];

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
  deleteErr?: Record<string, string>;
} = {}) {
  const count = opts.countPerTable ?? 0;
  const haltRows = opts.haltRows ?? [];
  const deleteErr = opts.deleteErr ?? {};

  // Builder returned for any `.delete()` call — supports .gt/.neq/.gte filter chaining
  const deleteBuilder = (table: string) => {
    const err = deleteErr[table] ? { message: deleteErr[table] } : null;
    const result = Promise.resolve({ error: err });
    return { gt: jest.fn().mockReturnValue(result), neq: jest.fn().mockReturnValue(result), gte: jest.fn().mockReturnValue(result) };
  };

  const fromImpl = (table: string) => ({
    // Pre-wipe count: select('*', { count, head }) resolves to { count }
    select: jest.fn().mockImplementation((_cols: string, _opts?: { count?: string; head?: boolean }) => {
      if (table === 'system_halts') {
        // .select('halt_type').eq('active', true) → { data: haltRows }
        return { eq: jest.fn().mockResolvedValue({ data: haltRows }) };
      }
      if (table === 'broker_accounts') {
        // .select('id').eq().eq().limit() → { data: [{id}] }
        return { eq: jest.fn().mockReturnThis(), limit: jest.fn().mockResolvedValue({ data: [{ id: 'ba-uuid' }] }) };
      }
      // count query: resolves directly with { count }
      return Promise.resolve({ count, data: null, error: null });
    }),
    delete: jest.fn().mockReturnValue(deleteBuilder(table)),
    update: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ error: null }) }),
    insert: jest.fn().mockResolvedValue({ error: null }),
  });

  return { from: jest.fn().mockImplementation(fromImpl) };
}

describe('AdminResetService', () => {
  it('happy path: closes 1 trade, wipes 6 tables, re-baselines equity', async () => {
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

  it('aborts if a table delete fails', async () => {
    const broker = makeBroker({ openTrades: [], openTradesAfterClose: [] });
    const supabase = makeSupabase({ deleteErr: { signals: 'permission denied' } });
    const svc = new AdminResetService(supabase as any, broker as any);
    await expect(svc.ledgerReset()).rejects.toThrow('Failed to wipe signals');
  });
});
