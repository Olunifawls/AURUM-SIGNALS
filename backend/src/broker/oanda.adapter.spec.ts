import { OandaAdapter } from './oanda.adapter';
import { AmbiguousSubmitError } from './broker.interface';

function res(status: number, body: unknown) {
  return { status, text: async () => JSON.stringify(body) } as unknown as Response;
}

describe('OandaAdapter', () => {
  const OLD = { ...process.env };
  let fetchMock: jest.Mock;

  beforeEach(() => {
    process.env.OANDA_API_TOKEN_DEMO = 'demo-token';
    process.env.OANDA_ACCOUNT_ID_DEMO = '101-004-DEMO-001';
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });
  afterEach(() => {
    process.env = { ...OLD };
    jest.restoreAllMocks();
  });

  it('only ever calls the fxpractice URL (never a live URL)', async () => {
    fetchMock.mockResolvedValue(res(200, { account: { id: 'x', currency: 'GBP', balance: '1', NAV: '1', unrealizedPL: '0', openTradeCount: 0, lastTransactionID: '5' } }));
    await new OandaAdapter().getAccount();
    expect(fetchMock.mock.calls[0][0]).toContain('https://api-fxpractice.oanda.com');
    expect(fetchMock.mock.calls[0][0]).not.toContain('api-fxtrade'); // never the live host
  });

  it('getAccount parses the summary', async () => {
    fetchMock.mockResolvedValue(res(200, { account: { id: '101-004-DEMO-001', currency: 'GBP', balance: '1000.50', NAV: '1005.25', unrealizedPL: '4.75', openTradeCount: 1, lastTransactionID: '42' } }));
    const a = await new OandaAdapter().getAccount();
    expect(a).toMatchObject({ currency: 'GBP', balance: 1000.5, equity: 1005.25, openTradeCount: 1, lastTransactionId: '42' });
  });

  it('idempotent reads retry on network error (x3)', async () => {
    fetchMock
      .mockRejectedValueOnce(new Error('ETIMEDOUT'))
      .mockRejectedValueOnce(new Error('ETIMEDOUT'))
      .mockResolvedValueOnce(res(200, { account: { id: 'x', currency: 'USD', balance: '1', NAV: '1', unrealizedPL: '0', openTradeCount: 0, lastTransactionID: '5' } }));
    const a = await new OandaAdapter().getAccount();
    expect(a.currency).toBe('USD');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('placeMarketOrder FILLED parses broker order/trade ids + fill price', async () => {
    fetchMock.mockResolvedValue(res(201, { orderFillTransaction: { orderID: 'O1', price: '2345.678', tradeOpened: { tradeID: 'T1' } } }));
    const r = await new OandaAdapter().placeMarketOrder({ instrument: 'XAU_USD', side: 'BUY', units: 1, stopLossPrice: 2300, takeProfitPrice: 2400, clientTag: 'aurum-s1' });
    expect(r).toMatchObject({ status: 'FILLED', brokerOrderId: 'O1', brokerTradeId: 'T1', fillPrice: 2345.678 });
    // request body carries integer units + the reconciliation tag + SL/TP in one call
    const body = JSON.parse((fetchMock.mock.calls[0][1] as any).body);
    expect(body.order.units).toBe('1');
    expect(body.order.clientExtensions.id).toBe('aurum-s1');
    // the resulting TRADE must also carry the tag so getOpenTrades/reconcile can
    // match it by tag (order clientExtensions do not propagate to the trade)
    expect(body.order.tradeClientExtensions.id).toBe('aurum-s1');
    expect(body.order.stopLossOnFill.price).toBe('2300.000');
    expect(body.order.takeProfitOnFill.price).toBe('2400.000');
  });

  it('placeMarketOrder REJECT returns REJECTED + reason (definitive, not retried)', async () => {
    fetchMock.mockResolvedValue(res(201, { orderCancelTransaction: { reason: 'MARKET_HALTED' } }));
    const r = await new OandaAdapter().placeMarketOrder({ instrument: 'XAU_USD', side: 'SELL', units: 1, clientTag: 'aurum-s2' });
    expect(r.status).toBe('REJECTED');
    expect(r.reason).toBe('MARKET_HALTED');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('placeMarketOrder NEVER retries on ambiguous network failure -> throws AmbiguousSubmitError once', async () => {
    fetchMock.mockRejectedValue(new Error('socket hang up'));
    await expect(
      new OandaAdapter().placeMarketOrder({ instrument: 'XAU_USD', side: 'BUY', units: 1, clientTag: 'aurum-s3' }),
    ).rejects.toBeInstanceOf(AmbiguousSubmitError);
    expect(fetchMock).toHaveBeenCalledTimes(1); // NOT retried
  });

  it('SELL sends negative units', async () => {
    fetchMock.mockResolvedValue(res(201, { orderFillTransaction: { orderID: 'O', price: '2000', tradeOpened: { tradeID: 'T' } } }));
    await new OandaAdapter().placeMarketOrder({ instrument: 'XAU_USD', side: 'SELL', units: 3, clientTag: 'aurum-s4' });
    const body = JSON.parse((fetchMock.mock.calls[0][1] as any).body);
    expect(body.order.units).toBe('-3');
  });
});
