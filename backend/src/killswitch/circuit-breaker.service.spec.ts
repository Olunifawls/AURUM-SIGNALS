import { CircuitBreakerService } from './circuit-breaker.service';

const NOW = new Date('2026-07-09T12:00:00Z'); // Wednesday midday UTC (market open)
// Recent candle ts within the 20min feed-stale window.
const RECENT_TS = new Date(NOW.getTime() - 5 * 60_000).toISOString();

// runBreakers early-exits without OANDA_ACCOUNT_ID_DEMO — set it for all tests.
const OLD_ENV = { ...process.env };
beforeAll(() => { process.env.OANDA_ACCOUNT_ID_DEMO = 'test-001'; });
afterAll(() => { process.env = OLD_ENV; });

/** Supabase mock with per-table overrides. Falls back to empty data. */
function makeSupabase(tableData: Record<string, any[]> = {}) {
  return {
    from: (table: string) => {
      const rows = tableData[table] ?? [];
      let eqFilters: [string, unknown][] = [];
      const b: any = {
        select: () => b,
        eq: (k: string, v: unknown) => { eqFilters = [...eqFilters, [k, v]]; return b; },
        lte: () => b,
        order: () => b,
        upsert: () => Promise.resolve({ error: null }),
        insert: () => Promise.resolve({ error: null }),
        update: () => ({ eq: () => Promise.resolve({ error: null }) }),
        limit: (n: number) => {
          // Filter indicator_snapshots and candles rows by timeframe eq.
          const tfFilter = eqFilters.find(([k]) => k === 'timeframe');
          const filtered = tfFilter
            ? rows.filter((r: any) => r.timeframe == null || r.timeframe === tfFilter[1])
            : rows;
          return Promise.resolve({ data: filtered.slice(0, n), error: null, count: filtered.length });
        },
      };
      return b;
    },
  } as any;
}

function makeState(overrides: Partial<{
  activeHalts: any[];
}> = {}) {
  return {
    getActiveHalts: jest.fn(async () => overrides.activeHalts ?? []),
    setHalt: jest.fn(async () => {}),
    clearHalt: jest.fn(async () => {}),
    isHalted: jest.fn(async () => false),
    isVolatilityCooldown: jest.fn(async () => false),
  } as any;
}

function makeBroker(spreadOverride = 0.35) {
  return {
    getAccount: jest.fn(async () => ({ equity: 10_000, currency: 'GBP', balance: 10_000, unrealizedPl: 0, marginUsed: 0, openTradeCount: 0, lastTransactionId: '1' })),
    getPricing: jest.fn(async () => ({ instrument: 'XAU/USD', bid: 4124.0, ask: 4124.0 + spreadOverride, spread: spreadOverride, tradeable: true })),
    getOpenTrades: jest.fn(async () => []),
  } as any;
}

const alerts = { sendAdminError: jest.fn(async () => true) } as any;

// ─── VOLATILITY COOLDOWN ────────────────────────────────────────────────────

describe('(b) VOLATILITY COOLDOWN wiring — evalVolatility called with real inputs', () => {
  it('fires (range > 3×ATR14) and applySpec sets halt + logs risk_event + alerts', async () => {
    const state = makeState(); // no active halts
    const broker = makeBroker(0.35);
    const sb = makeSupabase({
      equity_snapshots: [{ equity: 10_000, high_water_mark: 10_000 }],
      candles: [
        // Single row supplies ts for lastFeedTs AND open/high/low/close for latestCandle.
        // range = 4180 - 4100 = 80 > 3×5.2 = 15.6 → fires
        { timeframe: '15min', ts: RECENT_TS, open: 4100, high: 4180, low: 4100, close: 4120 },
      ],
      indicator_snapshots: [
        { timeframe: '15min', atr_14: 5.2 },
        { timeframe: '1h',    atr_14: 14.8 },
        { timeframe: '1day',  atr_14: 94.7 },
      ],
      positions: [],
    });

    const svc = new CircuitBreakerService(sb, broker, state, alerts);
    await svc.runBreakers(NOW);

    expect(state.setHalt).toHaveBeenCalledWith(
      'VOLATILITY_COOLDOWN',
      expect.objectContaining({ scope: 'NEW_ORDERS', requiresManual: false }),
    );
    expect(alerts.sendAdminError).toHaveBeenCalledWith(
      'halt-VOLATILITY_COOLDOWN',
      expect.stringContaining('HALT VOLATILITY_COOLDOWN'),
    );
  });

  it('does NOT fire when range is within 3×ATR14 threshold', async () => {
    const state = makeState();
    const broker = makeBroker(0.35);
    const sb = makeSupabase({
      equity_snapshots: [{ equity: 10_000, high_water_mark: 10_000 }],
      candles: [
        { timeframe: '15min', ts: RECENT_TS },
        // range = 4105 - 4100 = 5 ≪ 3×5.2 = 15.6 → calm
        { timeframe: '15min', open: 4100, high: 4105, low: 4100, close: 4103 },
      ],
      indicator_snapshots: [
        { timeframe: '15min', atr_14: 5.2 },
        { timeframe: '1h',    atr_14: 14.8 },
        { timeframe: '1day',  atr_14: 94.7 },
      ],
      positions: [],
    });

    const svc = new CircuitBreakerService(sb, broker, state, alerts);
    await svc.runBreakers(NOW);

    expect(state.setHalt).not.toHaveBeenCalledWith('VOLATILITY_COOLDOWN', expect.anything());
  });

  it('fires via SPREAD spike (spread > 2.5×24hAvg)', async () => {
    const wideSpread = 1.5; // > 2.5 × 0.35 = 0.875
    const state = makeState();
    const broker = makeBroker(wideSpread);
    const sb = makeSupabase({
      equity_snapshots: [{ equity: 10_000, high_water_mark: 10_000 }],
      candles: [
        { timeframe: '15min', ts: RECENT_TS },
        // calm candle — spread alone fires this
        { timeframe: '15min', open: 4100, high: 4105, low: 4100, close: 4103 },
      ],
      indicator_snapshots: [
        { timeframe: '15min', atr_14: 5.2 },
        { timeframe: '1h',    atr_14: 14.8 },
        { timeframe: '1day',  atr_14: 94.7 },
      ],
      positions: [],
    });

    const svc = new CircuitBreakerService(sb, broker, state, alerts);
    // Pre-seed spread history so the average is representative (0.35).
    for (let i = 0; i < 10; i++) (svc as any).spreadHistory.push(0.35);
    await svc.runBreakers(NOW);

    expect(state.setHalt).toHaveBeenCalledWith('VOLATILITY_COOLDOWN', expect.anything());
  });

  it('skips volatility evaluation when VOLATILITY_COOLDOWN is already active (no timer extension)', async () => {
    const state = makeState({
      activeHalts: [{ halt_type: 'VOLATILITY_COOLDOWN', active: true, requires_manual: false, clears_at: new Date(NOW.getTime() + 3600_000).toISOString() }],
    });
    const broker = makeBroker();
    const sb = makeSupabase({
      equity_snapshots: [{ equity: 10_000, high_water_mark: 10_000 }],
      candles: [
        { timeframe: '15min', ts: RECENT_TS },
        // extreme candle — but should NOT fire because already cooling
        { timeframe: '15min', open: 4100, high: 4200, low: 4050, close: 4150 },
      ],
      indicator_snapshots: [
        { timeframe: '15min', atr_14: 5.2 },
        { timeframe: '1h',    atr_14: 14.8 },
        { timeframe: '1day',  atr_14: 94.7 },
      ],
      positions: [],
    });

    const svc = new CircuitBreakerService(sb, broker, state, alerts);
    await svc.runBreakers(NOW);

    const vcCalls = (state.setHalt as jest.Mock).mock.calls.filter(([t]) => t === 'VOLATILITY_COOLDOWN');
    expect(vcCalls).toHaveLength(0);
  });
});

// ─── SESSION GAP ────────────────────────────────────────────────────────────

describe('(c) SESSION GAP wiring — evalSessionGap called with real inputs', () => {
  // Daily candle ts must be < 24h old to pass the staleness guard.
  const FRESH_DAILY_TS = new Date(NOW.getTime() - 10 * 3600_000).toISOString();
  const PREV_DAILY_TS  = new Date(NOW.getTime() - 34 * 3600_000).toISOString();

  it('fires when daily open gap > 1.5×dailyATR (large weekly gap scenario)', async () => {
    const state = makeState();
    const broker = makeBroker();
    const sb = makeSupabase({
      equity_snapshots: [{ equity: 10_000, high_water_mark: 10_000 }],
      candles: [
        { timeframe: '15min', ts: RECENT_TS },
        { timeframe: '15min', open: 4100, high: 4105, low: 4100, close: 4103 },
        // 1day pair: open=4300, prev close=4100 → gap=200 > 1.5×94.7=142.1 → fires
        { timeframe: '1day', ts: FRESH_DAILY_TS, open: 4300, close: 4310 },
        { timeframe: '1day', ts: PREV_DAILY_TS,  open: 4080, close: 4100 },
      ],
      indicator_snapshots: [
        { timeframe: '15min', atr_14: 5.2 },
        { timeframe: '1h',    atr_14: 14.8 },
        { timeframe: '1day',  atr_14: 94.7 },
      ],
      positions: [],
    });

    const svc = new CircuitBreakerService(sb, broker, state, alerts);
    await svc.runBreakers(NOW);

    expect(state.setHalt).toHaveBeenCalledWith(
      'SESSION_GAP',
      expect.objectContaining({ scope: 'NEW_ORDERS', requiresManual: false }),
    );
    expect(alerts.sendAdminError).toHaveBeenCalledWith(
      'halt-SESSION_GAP',
      expect.stringContaining('SESSION_GAP'),
    );
  });

  it('does NOT fire when gap is within 1.5×dailyATR', async () => {
    const state = makeState();
    const broker = makeBroker();
    const sb = makeSupabase({
      equity_snapshots: [{ equity: 10_000, high_water_mark: 10_000 }],
      candles: [
        { timeframe: '15min', ts: RECENT_TS },
        { timeframe: '15min', open: 4100, high: 4105, low: 4100, close: 4103 },
        // gap = |4110 - 4100| = 10 ≪ 1.5×94.7=142 → calm
        { timeframe: '1day', ts: FRESH_DAILY_TS, open: 4110, close: 4115 },
        { timeframe: '1day', ts: PREV_DAILY_TS,  open: 4095, close: 4100 },
      ],
      indicator_snapshots: [
        { timeframe: '15min', atr_14: 5.2 },
        { timeframe: '1h',    atr_14: 14.8 },
        { timeframe: '1day',  atr_14: 94.7 },
      ],
      positions: [],
    });

    const svc = new CircuitBreakerService(sb, broker, state, alerts);
    await svc.runBreakers(NOW);

    const sgCalls = (state.setHalt as jest.Mock).mock.calls.filter(([t]) => t === 'SESSION_GAP');
    expect(sgCalls).toHaveLength(0);
  });

  it('skips session-gap evaluation if SESSION_GAP is already active', async () => {
    const state = makeState({
      activeHalts: [{ halt_type: 'SESSION_GAP', active: true, requires_manual: false, clears_at: new Date(NOW.getTime() + 7200_000).toISOString() }],
    });
    const broker = makeBroker();
    const sb = makeSupabase({
      equity_snapshots: [{ equity: 10_000, high_water_mark: 10_000 }],
      candles: [
        { timeframe: '15min', ts: RECENT_TS },
        { timeframe: '15min', open: 4100, high: 4105, low: 4100, close: 4103 },
        { timeframe: '1day', ts: FRESH_DAILY_TS, open: 4300, close: 4310 },
        { timeframe: '1day', ts: PREV_DAILY_TS,  open: 4080, close: 4100 },
      ],
      indicator_snapshots: [
        { timeframe: '15min', atr_14: 5.2 },
        { timeframe: '1h',    atr_14: 14.8 },
        { timeframe: '1day',  atr_14: 94.7 },
      ],
      positions: [],
    });

    const svc = new CircuitBreakerService(sb, broker, state, alerts);
    await svc.runBreakers(NOW);

    const sgCalls = (state.setHalt as jest.Mock).mock.calls.filter(([t]) => t === 'SESSION_GAP');
    expect(sgCalls).toHaveLength(0);
  });

  it('skips session-gap evaluation when most recent daily candle is > 24h old (staleness guard)', async () => {
    const STALE_DAILY_TS = new Date(NOW.getTime() - 26 * 3600_000).toISOString(); // older than 24h
    const state = makeState();
    const broker = makeBroker();
    const sb = makeSupabase({
      equity_snapshots: [{ equity: 10_000, high_water_mark: 10_000 }],
      candles: [
        { timeframe: '15min', ts: RECENT_TS },
        { timeframe: '15min', open: 4100, high: 4105, low: 4100, close: 4103 },
        // This would trigger but the candle is stale (>24h) so we skip
        { timeframe: '1day', ts: STALE_DAILY_TS, open: 4300, close: 4310 },
        { timeframe: '1day', ts: PREV_DAILY_TS,  open: 4080, close: 4100 },
      ],
      indicator_snapshots: [
        { timeframe: '15min', atr_14: 5.2 },
        { timeframe: '1h',    atr_14: 14.8 },
        { timeframe: '1day',  atr_14: 94.7 },
      ],
      positions: [],
    });

    const svc = new CircuitBreakerService(sb, broker, state, alerts);
    await svc.runBreakers(NOW);

    const sgCalls = (state.setHalt as jest.Mock).mock.calls.filter(([t]) => t === 'SESSION_GAP');
    expect(sgCalls).toHaveLength(0);
  });
});

// ─── testFireBreaker (admin test-fire path) ──────────────────────────────────

describe('(d) testFireBreaker — admin synthetic-input fire path', () => {
  it('fires VOLATILITY_COOLDOWN with synthetic inputs and applies the spec', async () => {
    const state = makeState();
    const broker = makeBroker();
    const sb = makeSupabase({ risk_events: [] });

    const svc = new CircuitBreakerService(sb, broker, state, alerts);
    const spec = await svc.testFireBreaker('VOLATILITY_COOLDOWN', {
      lastRange: 20, atr14: 5, priceMove15m: 1, hourlyAtr: 14, spread: 0.3, spread24hAvg: 0.3,
    });

    expect(spec).not.toBeNull();
    expect(spec?.type).toBe('VOLATILITY_COOLDOWN');
    expect(state.setHalt).toHaveBeenCalledWith('VOLATILITY_COOLDOWN', expect.anything());
  });

  it('fires SESSION_GAP with synthetic inputs and applies the spec', async () => {
    const state = makeState();
    const broker = makeBroker();
    const sb = makeSupabase({ risk_events: [] });

    const svc = new CircuitBreakerService(sb, broker, state, alerts);
    const spec = await svc.testFireBreaker('SESSION_GAP', { openGap: 200, dailyAtr: 94 });

    expect(spec).not.toBeNull();
    expect(spec?.type).toBe('SESSION_GAP');
    expect(state.setHalt).toHaveBeenCalledWith('SESSION_GAP', expect.anything());
  });

  it('returns null (does not apply) when inputs are below threshold', async () => {
    const state = makeState();
    const broker = makeBroker();
    const sb = makeSupabase({});

    const svc = new CircuitBreakerService(sb, broker, state, alerts);
    const spec = await svc.testFireBreaker('VOLATILITY_COOLDOWN', {
      lastRange: 1, atr14: 5, priceMove15m: 1, hourlyAtr: 14, spread: 0.3, spread24hAvg: 0.3,
    });

    expect(spec).toBeNull();
    expect(state.setHalt).not.toHaveBeenCalled();
  });
});

// ─── clearsAt time-box (auto-clear rule) ─────────────────────────────────────

describe('(e) clearsAt — timed auto-clear rule encoded in HaltSpec', () => {
  it('VOLATILITY_COOLDOWN clears 2h from now', async () => {
    const state = makeState();
    const sb = makeSupabase({ risk_events: [] });
    const svc = new CircuitBreakerService(sb, makeBroker(), state, alerts);

    const spec = await svc.testFireBreaker('VOLATILITY_COOLDOWN', {
      lastRange: 20, atr14: 5, priceMove15m: 1, hourlyAtr: 14, spread: 0.3, spread24hAvg: 0.3,
    }, NOW);

    expect(spec?.clearsAt?.getTime()).toBeCloseTo(NOW.getTime() + 2 * 3600_000, -2);
  });

  it('SESSION_GAP clears 4h from now', async () => {
    const state = makeState();
    const sb = makeSupabase({ risk_events: [] });
    const svc = new CircuitBreakerService(sb, makeBroker(), state, alerts);

    const spec = await svc.testFireBreaker('SESSION_GAP', { openGap: 200, dailyAtr: 94 }, NOW);

    expect(spec?.clearsAt?.getTime()).toBeCloseTo(NOW.getTime() + 4 * 3600_000, -2);
  });
});
