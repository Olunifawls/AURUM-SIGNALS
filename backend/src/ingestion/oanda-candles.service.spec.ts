import { OandaCandlesService } from './oanda-candles.service';

function res(candles: unknown[]) {
  return { ok: true, json: async () => ({ candles }) } as unknown as Response;
}

describe('OandaCandlesService (FIX-1 candle source)', () => {
  const OLD = { ...process.env };
  let fetchMock: jest.Mock;
  let svc: OandaCandlesService;

  beforeEach(() => {
    process.env.OANDA_API_TOKEN_DEMO = 'demo-token';
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    svc = new OandaCandlesService();
  });
  afterEach(() => {
    process.env = { ...OLD };
    jest.restoreAllMocks();
  });

  const bar = (time: string, c: number, complete = true) => ({
    time,
    complete,
    volume: 10,
    mid: { o: String(c - 1), h: String(c + 2), l: String(c - 2), c: String(c) },
  });

  it('stores COMPLETE bars only (drops the still-forming bar) with mid OHLC', async () => {
    fetchMock.mockResolvedValue(
      res([bar('2026-07-09T12:00:00.000000000Z', 4108), bar('2026-07-09T16:00:00.000000000Z', 4123, false)]),
    );
    const out = await svc.fetchCandles('4h');
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ ts: '2026-07-09T12:00:00.000Z', open: 4107, high: 4110, low: 4106, close: 4108 });
  });

  it('uses the correct granularity + UTC alignment params (H4 -> 00/04/08/12/16/20)', async () => {
    fetchMock.mockResolvedValue(res([]));
    await svc.fetchCandles('4h');
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('/v3/instruments/XAU_USD/candles');
    expect(url).toContain('granularity=H4');
    expect(url).toContain('alignmentTimezone=UTC');
    expect(url).toContain('dailyAlignment=0');
    expect(url).toContain('price=M');
  });

  it('maps our timeframes to OANDA granularities', async () => {
    fetchMock.mockResolvedValue(res([]));
    await svc.fetchCandles('15min');
    expect(fetchMock.mock.calls[0][0]).toContain('granularity=M15');
    await svc.fetchCandles('1h');
    expect(fetchMock.mock.calls[1][0]).toContain('granularity=H1');
    await svc.fetchCandles('1day');
    expect(fetchMock.mock.calls[2][0]).toContain('granularity=D');
  });

  it('rejects junk: future-dated and non-positive/non-finite OHLC', async () => {
    const future = new Date(Date.now() + 3 * 24 * 3600_000).toISOString();
    fetchMock.mockResolvedValue(
      res([
        bar(future, 4100), // future -> rejected
        { time: '2026-07-09T12:00:00Z', complete: true, mid: { o: '0', h: '1', l: '1', c: '1' } }, // o=0 -> rejected
        { time: '2026-07-09T08:00:00Z', complete: true, mid: { o: 'x', h: '1', l: '1', c: '1' } }, // NaN -> rejected
        bar('2026-07-09T04:00:00Z', 4064), // valid
      ]),
    );
    const out = await svc.fetchCandles('4h');
    expect(out).toHaveLength(1);
    expect(out[0].close).toBe(4064);
  });

  it('fetchFx returns the latest COMPLETE GBP_USD mid close', async () => {
    fetchMock.mockResolvedValue(
      res([bar('2026-07-09T18:30:00Z', 1.3412), bar('2026-07-09T18:45:00Z', 1.3416), bar('2026-07-09T19:00:00Z', 1.3419, false)]),
    );
    const fx = await svc.fetchFx();
    expect(fx.rate).toBeCloseTo(1.3416, 4);
    expect((fetchMock.mock.calls[0][0] as string)).toContain('/v3/instruments/GBP_USD/candles');
  });
});
