import { AdminResetService } from './admin-reset.service';

const makeBroker = (overrides: Partial<{
  openTrades: any[];
  openTradesAfterClose: any[];
  closeErr?: Error;
  equity: number;
  balance: number;
  currency: string;
}> = {}) => {
  const openTrades = overrides.openTrades ?? [];
  const openTradesAfterClose = overrides.openTradesAfterClose ?? [];
  let callCount = 0;
  return {
    getOpenTrades: jest.fn().mockImplementation(() => {
      callCount++;
      return Promise.resolve(callCount === 1 ? openTrades : openTradesAfterClose);
    }),
    closeTrade: jest.fn().mockImplementation(() =>
      overrides.closeErr ? Promise.reject(overrides.closeErr) : Promise.resolve({ closed: true }),
    ),
    getAccount: jest.fn().mockResolvedValue({
      equity: overrides.equity ?? 10000,
      balance: overrides.balance ?? 10000,
      currency: overrides.currency ?? 'GBP',
      unrealizedPl: 0,
      marginUsed: 0,
      openTradeCount: 0,
      lastTransactionId: '999',
      id: 'demo-account',
    }),
  };
};

const makeSupabase = (rpcResult: any = { signals: 63, orders: 5, positions: 5, performance_daily: 3, risk_events: 250, equity_snapshots: 10, halts_cleared: 1 }) => ({
  rpc: jest.fn().mockResolvedValue({ data: rpcResult, error: null }),
  from: jest.fn().mockReturnValue({
    select: jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue({ data: [{ id: 'ba-uuid-001' }] }),
    }),
    insert: jest.fn().mockResolvedValue({ error: null }),
  }),
});

describe('AdminResetService', () => {
  it('happy path: closes 1 trade, wipes ledger, re-baselines equity', async () => {
    const trade = { id: 'trade-1', side: 'SELL' as const, units: 5, instrument: 'XAU_USD', price: 4100, unrealizedPl: -200 };
    const broker = makeBroker({ openTrades: [trade], openTradesAfterClose: [] });
    const supabase = makeSupabase();
    const svc = new AdminResetService(supabase as any, broker as any);

    const result = await svc.ledgerReset();

    expect(broker.closeTrade).toHaveBeenCalledWith('trade-1');
    expect(broker.getOpenTrades).toHaveBeenCalledTimes(2); // before + verify
    expect(supabase.rpc).toHaveBeenCalledWith('reset_demo_ledger');
    expect(result.flattenedTrades).toBe(1);
    expect(result.openTradesAfter).toBe(0);
    expect(result.wipedCounts['signals']).toBe(63);
    expect(result.haltsCleared).toBe(1);
    expect(result.baselineEquity).toBe(10000);
    expect(result.baselineCcy).toBe('GBP');
    // Three baseline equity_snapshots inserted.
    const inserted = supabase.from('equity_snapshots').insert.mock?.calls?.[0]?.[0];
    expect(inserted).toHaveLength(3);
    const types = inserted.map((s: any) => s.snapshot_type);
    expect(types).toEqual(expect.arrayContaining(['HOURLY', 'DAILY_REF', 'WEEKLY_REF']));
    expect(inserted[0].high_water_mark).toBe(10000);
  });

  it('no open trades: skips close, still wipes and re-baselines', async () => {
    const broker = makeBroker({ openTrades: [], openTradesAfterClose: [] });
    const svc = new AdminResetService(makeSupabase() as any, broker as any);
    const result = await svc.ledgerReset();
    expect(broker.closeTrade).not.toHaveBeenCalled();
    expect(result.flattenedTrades).toBe(0);
  });

  it('aborts if closeTrade throws', async () => {
    const broker = makeBroker({
      openTrades: [{ id: 'tx', side: 'SELL' as const, units: 1, instrument: 'XAU_USD', price: 0, unrealizedPl: 0 }],
      closeErr: new Error('OANDA timeout'),
    });
    const svc = new AdminResetService(makeSupabase() as any, broker as any);
    await expect(svc.ledgerReset()).rejects.toThrow('Failed to close trade tx');
  });

  it('aborts if account is not flat after close', async () => {
    const leftOver = { id: 'ghost', side: 'BUY' as const, units: 1, instrument: 'XAU_USD', price: 0, unrealizedPl: 0 };
    const broker = makeBroker({
      openTrades: [{ ...leftOver, id: 'ghost' }],
      openTradesAfterClose: [leftOver], // still there after close
    });
    const svc = new AdminResetService(makeSupabase() as any, broker as any);
    await expect(svc.ledgerReset()).rejects.toThrow('not flat after close');
  });

  it('aborts if RPC wipe fails', async () => {
    const broker = makeBroker({ openTrades: [], openTradesAfterClose: [] });
    const supabase = {
      rpc: jest.fn().mockResolvedValue({ data: null, error: { message: 'permission denied' } }),
      from: jest.fn(),
    };
    const svc = new AdminResetService(supabase as any, broker as any);
    await expect(svc.ledgerReset()).rejects.toThrow('Ledger wipe failed');
  });
});
