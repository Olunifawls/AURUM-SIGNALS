import { OrderPlacementService } from './order-placement.service';
import { AmbiguousSubmitError, IBrokerAdapter } from './broker.interface';

function supabaseMock(opts: { insertError?: { code?: string; message?: string } } = {}) {
  const updates: Array<Record<string, unknown>> = [];
  const client = {
    from() {
      return {
        insert() {
          return {
            select() {
              return {
                async single() {
                  return opts.insertError
                    ? { data: null, error: opts.insertError }
                    : { data: { id: 'order-1' }, error: null };
                },
              };
            },
          };
        },
        update(fields: Record<string, unknown>) {
          return {
            async eq() {
              updates.push(fields);
              return { error: null };
            },
          };
        },
      };
    },
  };
  return { client: client as any, updates };
}

function adapterMock(over: Partial<IBrokerAdapter> = {}): IBrokerAdapter {
  return {
    getAccount: jest.fn(async () => ({
      id: 'a',
      currency: 'GBP',
      balance: 1000,
      equity: 1000,
      unrealizedPl: 0,
      openTradeCount: 0,
      lastTransactionId: '100',
    })),
    getOpenTrades: jest.fn(async () => []),
    placeMarketOrder: jest.fn(async () => ({
      status: 'FILLED',
      brokerOrderId: 'o1',
      brokerTradeId: 't1',
      fillPrice: 2000,
    })),
    closeTrade: jest.fn(async () => ({ closed: true })),
    getTransactionsSince: jest.fn(async () => []),
    ...over,
  } as IBrokerAdapter;
}

const baseInput = { signalId: 'sig-1', brokerAccountId: 'acc-1', side: 'BUY' as const, units: 1, stopLoss: 1990, takeProfit: 2020 };

describe('(d) OrderPlacementService — idempotency', () => {
  it('DB pre-insert guard: a duplicate active order is blocked and NEVER submitted', async () => {
    const { client } = supabaseMock({ insertError: { code: '23505', message: 'uq_orders_active_signal' } });
    const adapter = adapterMock();
    const svc = new OrderPlacementService(client, adapter);

    const out = await svc.placeForSignal(baseInput);

    expect(out.status).toBe('DUPLICATE');
    expect(out.placed).toBe(false);
    expect(adapter.placeMarketOrder).toHaveBeenCalledTimes(0); // did NOT submit
  });

  it('ambiguous submit + tag FOUND on reconcile -> FILLED, and placeMarketOrder called EXACTLY once (no retry)', async () => {
    const { client, updates } = supabaseMock();
    const place = jest.fn(async () => {
      throw new AmbiguousSubmitError('timeout after send');
    });
    const adapter = adapterMock({
      placeMarketOrder: place as any,
      getTransactionsSince: jest.fn(async () => [
        { id: '101', type: 'ORDER_FILL', clientTag: 'aurum-sig-1' },
      ]),
    });
    const svc = new OrderPlacementService(client, adapter);

    const out = await svc.placeForSignal(baseInput);

    expect(place).toHaveBeenCalledTimes(1); // NEVER blind-retried
    expect(out.status).toBe('FILLED');
    expect(out.reconciled).toBe(true);
    expect(updates.some((u) => u.status === 'FILLED')).toBe(true);
  });

  it('ambiguous submit + tag NOT found -> ERROR (no duplicate), placeMarketOrder called once', async () => {
    const { client, updates } = supabaseMock();
    const place = jest.fn(async () => {
      throw new AmbiguousSubmitError('timeout after send');
    });
    const adapter = adapterMock({
      placeMarketOrder: place as any,
      getTransactionsSince: jest.fn(async () => []),
      getOpenTrades: jest.fn(async () => []),
    });
    const svc = new OrderPlacementService(client, adapter);

    const out = await svc.placeForSignal(baseInput);

    expect(place).toHaveBeenCalledTimes(1);
    expect(out.status).toBe('ERROR');
    expect(updates.some((u) => u.status === 'ERROR')).toBe(true);
  });

  it('happy path FILLED records broker ids', async () => {
    const { client, updates } = supabaseMock();
    const svc = new OrderPlacementService(client, adapterMock());
    const out = await svc.placeForSignal(baseInput);
    expect(out.status).toBe('FILLED');
    expect(out.brokerTradeId).toBe('t1');
    expect(updates.some((u) => u.broker_trade_id === 't1' && u.status === 'FILLED')).toBe(true);
  });

  it('broker REJECT records REJECTED with reason', async () => {
    const { client, updates } = supabaseMock();
    const adapter = adapterMock({
      placeMarketOrder: jest.fn(async () => ({ status: 'REJECTED', reason: 'MARKET_HALTED' })) as any,
    });
    const svc = new OrderPlacementService(client, adapter);
    const out = await svc.placeForSignal(baseInput);
    expect(out.status).toBe('REJECTED');
    expect(out.reason).toBe('MARKET_HALTED');
    expect(updates.some((u) => u.status === 'REJECTED')).toBe(true);
  });
});
