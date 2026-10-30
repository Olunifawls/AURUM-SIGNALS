import { parseCotRows, V1DataService } from './v1-data.service';

function makeSupabase(upsertError: { message: string } | null = null) {
  const upserts: Record<string, { rows: any[]; opts: any }[]> = {};
  const from = (table: string) => ({
    upsert: async (rows: any[], opts: any) => {
      (upserts[table] ??= []).push({ rows, opts });
      return { error: upsertError };
    },
  });
  return { client: { from } as any, upserts };
}

const candle = (ts: string, close: number) => ({ ts, open: close, high: close, low: close, close, volume: 1 });
const events = () => ({ warn: jest.fn(async () => undefined), info: jest.fn(async () => undefined) }) as any;

describe('parseCotRows', () => {
  it('reads date and managed-money positions, dropping unusable rows', () => {
    const rows = parseCotRows([
      { report_date_as_yyyy_mm_dd: '2026-10-27T00:00:00.000', m_money_positions_long_all: '122508', m_money_positions_short_all: '16946' },
      { report_date_as_yyyy_mm_dd: '2026-10-20T00:00:00.000', m_money_positions_long_all: 'x', m_money_positions_short_all: '1' },
    ]);
    expect(rows).toEqual([{ reportDate: '2026-10-27', managedMoneyLong: 122508, managedMoneyShort: 16946 }]);
  });
});

describe('V1DataService', () => {
  const OLD = { ...process.env };
  beforeEach(() => {
    process.env.OANDA_API_TOKEN_DEMO = 'demo-token';
  });
  afterEach(() => {
    process.env = { ...OLD };
    jest.restoreAllMocks();
  });

  it('refreshDaily stores gold in candles and the four macro series, all write-once', async () => {
    const { client, upserts } = makeSupabase();
    const oanda = { fetchInstrument: jest.fn(async () => [candle('2026-10-29T00:00:00.000Z', 1.5)]) } as any;
    await new V1DataService(client, oanda, events()).refreshDaily();

    expect(oanda.fetchInstrument.mock.calls.map((c: any[]) => c[0])).toEqual(['XAU_USD', 'EUR_USD', 'USD_JPY', 'USB10Y_USD', 'USB02Y_USD']);
    expect(upserts.candles[0].rows[0]).toMatchObject({ symbol: 'XAU/USD', timeframe: '1day' });
    expect(upserts.candles[0].opts.ignoreDuplicates).toBe(true);
    expect(upserts.macro_candles.map((u) => u.rows[0].instrument)).toEqual(['EUR_USD', 'USD_JPY', 'USB10Y_USD', 'USB02Y_USD']);
    expect(upserts.macro_candles.every((u) => u.opts.ignoreDuplicates)).toBe(true);
  });

  it('one instrument failing does not stop the others', async () => {
    const { client, upserts } = makeSupabase();
    const oanda = {
      fetchInstrument: jest.fn(async (i: string) => {
        if (i === 'USD_JPY') throw new Error('HTTP 503');
        return [candle('2026-10-29T00:00:00.000Z', 1.5)];
      }),
    } as any;
    const ev = events();
    await new V1DataService(client, oanda, ev).refreshDaily();
    expect(upserts.macro_candles).toHaveLength(3);
    expect(ev.warn).toHaveBeenCalledWith('v1-data', 'USD_JPY refresh failed', expect.anything());
  });

  it('backfills from 2025-06-01', async () => {
    const { client } = makeSupabase();
    const oanda = { fetchInstrument: jest.fn(async () => []) } as any;
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => [] })) as any;
    await new V1DataService(client, oanda, events()).backfill();
    expect(oanda.fetchInstrument).toHaveBeenCalledWith('EUR_USD', 'D', { count: 1000, from: '2025-06-01T00:00:00Z' });
  });

  it('refreshCot asks CFTC for dataset 72hh-3qpy, contract 088691', async () => {
    const { client, upserts } = makeSupabase();
    const fetchMock = jest.fn(async () => ({
      ok: true,
      json: async () => [{ report_date_as_yyyy_mm_dd: '2026-10-27T00:00:00.000', m_money_positions_long_all: '10', m_money_positions_short_all: '4' }],
    }));
    global.fetch = fetchMock as any;
    await new V1DataService(client, {} as any, events()).refreshCot();

    const url = decodeURIComponent(String((fetchMock.mock.calls[0] as any[])[0]));
    expect(url).toContain('publicreporting.cftc.gov/resource/72hh-3qpy.json');
    expect(url).toContain("cftc_contract_market_code='088691'");
    expect(upserts.cot_reports[0].rows).toEqual([{ report_date: '2026-10-27', managed_money_long: 10, managed_money_short: 4 }]);
  });

  it('a CFTC outage is logged, not thrown', async () => {
    const { client } = makeSupabase();
    global.fetch = jest.fn(async () => ({ ok: false, status: 503, statusText: 'x' })) as any;
    const ev = events();
    await new V1DataService(client, {} as any, ev).refreshCot();
    expect(ev.warn).toHaveBeenCalledWith('v1-data', 'COT refresh failed', expect.anything());
  });

  it('does nothing without a demo token', async () => {
    delete process.env.OANDA_API_TOKEN_DEMO;
    const oanda = { fetchInstrument: jest.fn() } as any;
    const svc = new V1DataService(makeSupabase().client, oanda, events());
    svc.onModuleInit();
    await svc.dailyCron();
    expect(oanda.fetchInstrument).not.toHaveBeenCalled();
  });
});
