import { ReconciliationService } from './reconciliation.service';
import { ExecutionReadinessService } from './readiness.service';

function makeSupabase(dbOpen: any[]) {
  const updated: Record<string, any[]> = {};
  const inserted: Record<string, any[]> = {};
  const from = (table: string) => {
    const b: any = {
      select: () => b,
      eq: () => b,
      order: () => b,
      limit: () => Promise.resolve({ data: table === 'broker_accounts' ? [{ id: 'ba-1' }] : [] }),
      insert: (rows: any) => { (inserted[table] ??= []).push(...(Array.isArray(rows) ? rows : [rows])); return { then: (r: any) => r({ error: null }) }; },
      update: (fields: any) => {
        const chain: any = { eq: () => chain, then: (r: any) => { (updated[table] ??= []).push(fields); return r({ error: null }); } };
        return chain;
      },
      then: (r: any) => r({ data: table === 'positions' ? dbOpen : [] }),
    };
    return b;
  };
  return { client: { from } as any, updated, inserted };
}

function makeAdapter(over: any = {}) {
  return {
    getAccount: jest.fn(async () => ({ id: 'a', currency: 'GBP', balance: 100000, equity: 100000, unrealizedPl: 0, marginUsed: 0, openTradeCount: 0, lastTransactionId: '50' })),
    getOpenTrades: jest.fn(async () => []),
    getTrade: jest.fn(async () => ({ id: 'T1', state: 'CLOSED', instrument: 'XAU_USD', units: 2.8, price: 2000, closePrice: 2020, realizedPl: 56 })),
    placeMarketOrder: jest.fn(),
    closeTrade: jest.fn(),
    getTransactionsSince: jest.fn(async () => []),
    getPricing: jest.fn(),
    getInstrument: jest.fn(),
    ...over,
  } as any;
}

const alerts = { sendAdminError: jest.fn(async () => undefined) } as any;
const breaker = { escalateUnexpectedFill: jest.fn(async () => undefined) } as any;
const openPos = { id: 'pos-1', broker_trade_id: 'T1', entry_price: 2000, stop_loss: 1990, take_profit: 2020, side: 'BUY', units: 2.8 };

describe('(b) RECONCILE-DETECTS-CLOSE (simulated)', () => {
  it('a DB-open position the broker shows closed is marked CLOSED with realized P/L and R', async () => {
    const { client, updated } = makeSupabase([openPos]);
    const adapter = makeAdapter(); // getOpenTrades -> [] (T1 gone), getTrade -> CLOSED @ 2020
    const svc = new ReconciliationService(client, adapter, new ExecutionReadinessService(), alerts, breaker);

    const res = await svc.reconcile();
    expect(res.closedByBroker).toBe(1);
    const upd = updated.positions?.[0];
    expect(upd).toMatchObject({ status: 'CLOSED', close_price: 2020, realized_pl: 56, close_reason: 'TP_HIT' });
    expect(upd.realized_r).toBeCloseTo(2, 6); // (2020-2000)/(2000-1990)
  });
});

describe('(c) RECONCILIATION NEVER WRITES TO THE BROKER', () => {
  it('a reconcile pass makes zero place/close broker calls', async () => {
    const { client } = makeSupabase([openPos]);
    const adapter = makeAdapter();
    const svc = new ReconciliationService(client, adapter, new ExecutionReadinessService(), alerts, breaker);

    await svc.reconcile();
    expect(adapter.placeMarketOrder).not.toHaveBeenCalled();
    expect(adapter.closeTrade).not.toHaveBeenCalled();
  });

  it('records an unknown broker trade in the DB (broker = source of truth) without closing it', async () => {
    const { client, inserted } = makeSupabase([]); // DB empty
    const adapter = makeAdapter({
      getOpenTrades: jest.fn(async () => [{ id: 'T9', instrument: 'XAU_USD', side: 'BUY', units: 1, price: 2000, unrealizedPl: 0, clientTag: 'aurum-x' }]),
    });
    const svc = new ReconciliationService(client, adapter, new ExecutionReadinessService(), alerts, breaker);

    const res = await svc.reconcile();
    expect(res.unknownRecorded).toBe(1);
    expect(inserted.positions?.[0]).toMatchObject({ broker_trade_id: 'T9', status: 'OPEN' });
    expect(adapter.closeTrade).not.toHaveBeenCalled();
  });
});
