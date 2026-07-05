import { RiskManagerService } from '../risk/risk-manager.service';
import { TradingStateService } from '../risk/trading-state.service';
import { OrderIntent, RiskContext } from '../risk/risk.types';

function makeSupabase(handlers: Record<string, (s: any) => any>) {
  const from = (table: string) => {
    const s: any = { opts: undefined, filters: [] };
    const result = () => Promise.resolve(handlers[table] ? handlers[table](s) : { data: [], count: 0 });
    const b: any = {
      select: (_a: any, opts: any) => { s.opts = opts; return b; },
      eq: () => b,
      lte: (k: string, v: any) => { s.filters.push([k, v]); return b; },
      order: () => b,
      limit: () => result(),
      insert: () => Promise.resolve({ error: null }),
      then: (res: any, rej: any) => result().then(res, rej),
    };
    return b;
  };
  return { from } as any;
}

function makeAdapter() {
  return {
    getAccount: jest.fn(async () => ({ id: 'a', currency: 'GBP', balance: 2000, equity: 2000, unrealizedPl: 0, marginUsed: 0, openTradeCount: 0, lastTransactionId: '1' })),
    getOpenTrades: jest.fn(async () => []),
    getPricing: jest.fn(async () => ({ instrument: 'XAU_USD', bid: 1999.7, ask: 2000, spread: 0.3, tradeable: true })),
    getInstrument: jest.fn(async () => ({ name: 'XAU_USD', type: 'METAL', marginRate: 0.05, minimumTradeSize: 0.1, tradeUnitsPrecision: 1, displayPrecision: 3 })),
  } as any;
}

const intent: OrderIntent = { signalId: 'sig-1', side: 'BUY', timeframe: '4h', entryPrice: 2000, stopLoss: 1991.6, takeProfit: 2016.8 };
const MIDWEEK_OPEN = new Date('2026-07-08T12:00:00Z');

describe('(g) INTEGRATION: a volatility cooldown makes RiskManager reject at check 4a', () => {
  const OLD = { ...process.env };
  afterEach(() => (process.env = { ...OLD }));

  it('an active VOLATILITY_COOLDOWN halt -> order rejected with VOLATILITY_COOLDOWN', async () => {
    for (const k of ['TRADING_MODE', 'AUTO_TRADE_ENABLED', 'MAX_OPEN_POSITIONS']) delete process.env[k];
    const client = makeSupabase({
      fx_rates: () => ({ data: [{ rate: 1.25 }] }),
      positions: (s) => (s.opts?.head ? { count: 0 } : { data: [] }),
      equity_snapshots: () => ({ data: [{ equity: 2000 }] }),
      system_halts: () => ({ data: [{ halt_type: 'VOLATILITY_COOLDOWN', active: true, requires_manual: false, clears_at: null }] }),
    });
    const state = new TradingStateService(client);
    const alerts = { sendAdminError: jest.fn(async () => false) } as any;
    const svc = new RiskManagerService(client, makeAdapter(), state, alerts);

    const d = await svc.assess(intent, { now: MIDWEEK_OPEN });
    expect(d.reason).toBe('VOLATILITY_COOLDOWN'); // check 4a, not TRADING_HALTED
  });
});

describe('(h) DEGRADED-NEWS alert fires via Telegram', () => {
  function degradedCtx(): RiskContext {
    return {
      now: MIDWEEK_OPEN, mode: 'demo', autoTradeEnabled: true, halted: false, resolvedDemoTrades: 100,
      session: { marketOpen: true, inFirstWindow: false, inLastWindow: false },
      news: { inBlackout: false, degraded: true, source: 'fallback' }, volatilityCooldown: false,
      brokerOpenTradeCount: 0, existingOpenSameDirTf: false, maxOpenPositions: 2,
      equity: 2000, accountCcy: 'GBP', gbpUsdRate: 1.25, referenceEquityDaily: 2000, referenceEquityWeekly: 2000, highWaterMark: 2000,
      maxDailyLossPct: 3, maxWeeklyLossPct: 6, maxTotalDrawdownPct: 20, spreadPoints: 0.3, maxSpreadPoints: 0.6,
      marginUsed: 0, marginRate: 0.05, price: 2000, riskPerTradePct: 1.0, maxSlippagePoints: 0.5, minTradeSize: 0.1, tier2Unlocked: false,
    };
  }

  it('sends the degraded-news admin alert when the calendar source is fallback', async () => {
    const client = makeSupabase({});
    const alerts = { sendAdminError: jest.fn(async () => true) } as any;
    const svc = new RiskManagerService(client, makeAdapter(), new TradingStateService(null as any), alerts);

    await svc.assess(intent, { context: degradedCtx() });
    expect(alerts.sendAdminError).toHaveBeenCalledWith('news-degraded', expect.stringContaining('DEGRADED'));
  });
});
