import { RiskManagerService } from './risk-manager.service';
import { TradingStateService } from './trading-state.service';
import { IBrokerAdapter } from '../broker/broker.interface';
import { OrderIntent, RiskContext } from './risk.types';

// Minimal thenable Supabase mock. Query results per table via `handlers`.
function makeSupabase(handlers: Record<string, (s: any) => any>) {
  const inserted: Record<string, any[]> = {};
  const from = (table: string) => {
    const s: any = { table, selectArg: undefined, opts: undefined, eqs: [], filters: [] };
    const result = () => Promise.resolve(handlers[table] ? handlers[table](s) : { data: [], count: 0 });
    const b: any = {
      select: (arg: any, opts: any) => { s.selectArg = arg; s.opts = opts; return b; },
      eq: (k: string, v: any) => { s.eqs.push([k, v]); return b; },
      lte: (k: string, v: any) => { s.filters.push(['lte', k, v]); return b; },
      order: () => b,
      limit: () => result(),
      insert: (rows: any) => { (inserted[table] ??= []).push(...(Array.isArray(rows) ? rows : [rows])); return Promise.resolve({ error: null }); },
      then: (res: any, rej: any) => result().then(res, rej),
    };
    return b;
  };
  return { client: { from } as any, inserted };
}

function makeAdapter(over: Partial<IBrokerAdapter> = {}): IBrokerAdapter {
  return {
    getAccount: jest.fn(async () => ({ id: 'a', currency: 'GBP', balance: 2000, equity: 2000, unrealizedPl: 0, marginUsed: 0, openTradeCount: 0, lastTransactionId: '1' })),
    getOpenTrades: jest.fn(async () => []),
    getPricing: jest.fn(async () => ({ instrument: 'XAU_USD', bid: 1999.7, ask: 2000, spread: 0.3, tradeable: true })),
    getInstrument: jest.fn(async () => ({ name: 'XAU_USD', type: 'METAL', marginRate: 0.05, minimumTradeSize: 0.1, tradeUnitsPrecision: 1, displayPrecision: 3 })),
    placeMarketOrder: jest.fn(),
    closeTrade: jest.fn(),
    getTransactionsSince: jest.fn(),
    ...over,
  } as IBrokerAdapter;
}

const intent: OrderIntent = { signalId: 'sig-1', side: 'BUY', timeframe: '4h', entryPrice: 2000, stopLoss: 1991.6, takeProfit: 2016.8 };
const MIDWEEK_OPEN = new Date('2026-07-08T12:00:00Z'); // Wednesday, market open, no news

const benignHandlers = {
  fx_rates: () => ({ data: [{ rate: 1.25 }] }),
  positions: (s: any) => (s.opts?.head ? { count: 0 } : { data: [] }),
  equity_snapshots: (s: any) => (s.filters.length ? { data: [{ equity: 2000 }] } : { data: [{ equity: 2000 }] }),
};

describe('(a) RiskManagerService logs rejections/warnings to risk_events', () => {
  const OLD = { ...process.env };
  afterEach(() => (process.env = { ...OLD }));

  function ctx(over: Partial<RiskContext>): RiskContext {
    return {
      now: MIDWEEK_OPEN, mode: 'demo', autoTradeEnabled: true, halted: false, resolvedDemoTrades: 100,
      session: { marketOpen: true, inFirstWindow: false, inLastWindow: false },
      news: { inBlackout: false, degraded: true, source: 'fallback' }, volatilityCooldown: false,
      brokerOpenTradeCount: 0, existingOpenSameDirTf: false, maxOpenPositions: 2,
      equity: 2000, accountCcy: 'GBP', gbpUsdRate: 1.25, referenceEquityDaily: 2000, referenceEquityWeekly: 2000, highWaterMark: 2000,
      maxDailyLossPct: 3, maxWeeklyLossPct: 6, maxTotalDrawdownPct: 20, spreadPoints: 0.3, maxSpreadPoints: 0.6,
      marginUsed: 0, marginRate: 0.05, price: 2000, riskPerTradePct: 1.0, maxSlippagePoints: 0.5, minTradeSize: 0.1, tier2Unlocked: false,
      ...over,
    };
  }

  it('a rejection inserts a risk_events row with the reason', async () => {
    const { client, inserted } = makeSupabase({});
    const svc = new RiskManagerService(client, makeAdapter(), new TradingStateService());
    const d = await svc.assess(intent, { context: ctx({ spreadPoints: 0.9 }) });
    expect(d.reason).toBe('SPREAD_TOO_WIDE');
    expect(inserted.risk_events?.some((r) => r.event_type === 'SPREAD_TOO_WIDE')).toBe(true);
  });

  it('an approval with a Tier-2 clamp logs TIER2_CLAMPED', async () => {
    const { client, inserted } = makeSupabase({});
    const svc = new RiskManagerService(client, makeAdapter(), new TradingStateService());
    const d = await svc.assess(intent, { context: ctx({ riskPerTradePct: 2.5, tier2Unlocked: false }) });
    expect(d.approved).toBe(true);
    expect(inserted.risk_events?.some((r) => r.event_type === 'TIER2_CLAMPED')).toBe(true);
  });
});

describe('(f) exposure reads LIVE broker open trades (D9)', () => {
  const OLD = { ...process.env };
  afterEach(() => (process.env = { ...OLD }));

  it('gather calls broker.getOpenTrades and rejects MAX_POSITIONS from broker state', async () => {
    for (const k of ['TRADING_MODE', 'AUTO_TRADE_ENABLED', 'MAX_OPEN_POSITIONS', 'RISK_PER_TRADE_PCT']) delete process.env[k];
    const openTrades = jest.fn(async () => [
      { id: '1', instrument: 'XAU_USD', side: 'BUY' as const, units: 1, price: 2000, unrealizedPl: 0 },
      { id: '2', instrument: 'XAU_USD', side: 'SELL' as const, units: 1, price: 2000, unrealizedPl: 0 },
    ]);
    const adapter = makeAdapter({ getOpenTrades: openTrades as any });
    const { client } = makeSupabase(benignHandlers);
    const svc = new RiskManagerService(client, adapter, new TradingStateService());

    const d = await svc.assess(intent, { now: MIDWEEK_OPEN });
    expect(openTrades).toHaveBeenCalled(); // broker state read, not just DB
    expect(d.reason).toBe('MAX_POSITIONS'); // 2 open >= MAX_OPEN_POSITIONS(2)
  });
});

describe('(g) loss baseline from equity_snapshots (00:00 UK reference)', () => {
  const OLD = { ...process.env };
  afterEach(() => (process.env = { ...OLD }));

  it('daily loss below the reference triggers DAILY_LOSS_HALT', async () => {
    for (const k of ['TRADING_MODE', 'AUTO_TRADE_ENABLED', 'MAX_DAILY_LOSS_PCT']) delete process.env[k];
    const adapter = makeAdapter({
      getAccount: jest.fn(async () => ({ id: 'a', currency: 'GBP', balance: 1900, equity: 1900, unrealizedPl: -100, marginUsed: 0, openTradeCount: 0, lastTransactionId: '1' })) as any,
    });
    const { client, inserted } = makeSupabase({
      ...benignHandlers,
      equity_snapshots: (s: any) => ({ data: [{ equity: 2000 }] }), // reference = 2000
    });
    const svc = new RiskManagerService(client, adapter, new TradingStateService());

    const d = await svc.assess(intent, { now: MIDWEEK_OPEN }); // equity 1900 vs ref 2000 = 5% > 3%
    expect(d.reason).toBe('DAILY_LOSS_HALT');
    expect(inserted.risk_events?.some((r) => r.event_type === 'DAILY_LOSS_HALT')).toBe(true);
  });
});
