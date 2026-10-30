import { ExecutionService, SignalForExec } from './execution.service';
import { ExecutionReadinessService } from './readiness.service';

function makeSupabase(handlers: Record<string, () => any> = {}) {
  const inserted: Record<string, any[]> = {};
  const updated: Record<string, any[]> = {};
  const selects: Record<string, string> = {};
  const from = (table: string) => {
    const term = () => Promise.resolve(handlers[table] ? handlers[table]() : { data: [] });
    const b: any = {
      select: (cols: string) => { selects[table] = cols; return b; },
      eq: () => b,
      in: () => b,
      order: () => b,
      limit: () => term(),
      single: () => term(),
      insert: (rows: any) => {
        (inserted[table] ??= []).push(...(Array.isArray(rows) ? rows : [rows]));
        return {
          select: () => ({ single: () => Promise.resolve({ data: { id: 'pos-1' }, error: null }) }),
          then: (r: any) => r({ error: null }),
        };
      },
      update: (fields: any) => ({ eq: () => { (updated[table] ??= []).push(fields); return Promise.resolve({ error: null }); } }),
      then: (r: any) => term().then(r),
    };
    return b;
  };
  return { client: { from } as any, inserted, updated, selects };
}

const SIZING = { units: 2.8, requestedEntry: 2000, stopLoss: 1991.6, takeProfit: 2016.8, riskPctActual: 0.9968, equityAtEntry: 2000, riskCcy: 20 };

function makeRisk(over: any = {}) {
  return { assess: jest.fn(async () => ({ approved: true, sizing: SIZING, events: [], ...over })) } as any;
}
function makePlacement(result: any = { status: 'FILLED', orderId: 'ord-1', brokerTradeId: 'T1', fillPrice: 2000 }) {
  return { placeForSignal: jest.fn(async () => result) } as any;
}
function ready(v = true) {
  const r = new ExecutionReadinessService();
  if (v) r.markReady();
  return r;
}
const quote = (bid: number, ask: number) => ({ instrument: 'XAU_USD', bid, ask, spread: ask - bid, tradeable: true });
const adapter = { closeTrade: jest.fn(), getTrade: jest.fn(), getPricing: jest.fn(async () => quote(1999.9, 2000.1)) } as any;

const coreSignal: SignalForExec = { id: 'sig-1', timeframe: '4h', direction: 'BUY', entry_price: 2000, stop_loss: 1991.6, take_profit: 2016.8, track: 'core', status: 'OPEN', created_at: new Date().toISOString() } as SignalForExec;

describe('(h) EXECUTION PATH', () => {
  const OLD = { ...process.env };
  beforeEach(() => { for (const k of ['AUTO_TRADE_ENABLED', 'MAX_SLIPPAGE_POINTS']) delete process.env[k]; });
  afterEach(() => (process.env = { ...OLD }));

  it('an APPROVED core signal flows signal -> RiskManager -> place -> position', async () => {
    const { client, inserted } = makeSupabase({ broker_accounts: () => ({ data: [{ id: 'ba-1' }] }) });
    const risk = makeRisk();
    const placement = makePlacement();
    const svc = new ExecutionService(client, adapter, risk, placement, ready(true));

    const out = await svc.executeSignal(coreSignal);
    expect(risk.assess).toHaveBeenCalled();
    expect(placement.placeForSignal).toHaveBeenCalled();
    expect(out.executed).toBe(true);
    expect(out.brokerTradeId).toBe('T1');
    expect(inserted.positions?.[0]).toMatchObject({ status: 'OPEN', timeframe: '4h', side: 'BUY', broker_trade_id: 'T1' });
  });

  it('an experimental 15min signal is NEVER executed', async () => {
    const { client } = makeSupabase();
    const risk = makeRisk();
    const placement = makePlacement();
    const svc = new ExecutionService(client, adapter, risk, placement, ready(true));

    const out = await svc.executeSignal({ ...coreSignal, track: 'experimental', timeframe: '15min' });
    expect(out).toMatchObject({ executed: false, reason: 'experimental_track_excluded' });
    expect(risk.assess).not.toHaveBeenCalled();
    expect(placement.placeForSignal).not.toHaveBeenCalled();
  });
});

describe('(d) startup-reconcile gate + no double-trade on restart', () => {
  const OLD = { ...process.env };
  beforeEach(() => delete process.env.AUTO_TRADE_ENABLED);
  afterEach(() => (process.env = { ...OLD }));

  it('places NOTHING until the first reconcile completes', async () => {
    const { client } = makeSupabase({ broker_accounts: () => ({ data: [{ id: 'ba-1' }] }) });
    const placement = makePlacement();
    const svc = new ExecutionService(client, adapter, makeRisk(), placement, ready(false));
    const out = await svc.executeSignal(coreSignal);
    expect(out).toMatchObject({ executed: false, reason: 'reconcile_pending' });
    expect(placement.placeForSignal).not.toHaveBeenCalled();
  });

  it('a re-execution whose order is already active (INC-1 uq guard) creates no duplicate', async () => {
    const { client, inserted } = makeSupabase({ broker_accounts: () => ({ data: [{ id: 'ba-1' }] }) });
    const placement = makePlacement({ status: 'DUPLICATE', reason: 'active order already exists for this signal' });
    const svc = new ExecutionService(client, adapter, makeRisk(), placement, ready(true));
    const out = await svc.executeSignal(coreSignal);
    expect(out.executed).toBe(false);
    expect(inserted.positions).toBeUndefined(); // no position created
  });
});

describe('(e) SLIPPAGE > max -> logged, order stands, RR recomputed', () => {
  const OLD = { ...process.env };
  beforeEach(() => { delete process.env.AUTO_TRADE_ENABLED; delete process.env.MAX_SLIPPAGE_POINTS; });
  afterEach(() => (process.env = { ...OLD }));

  it('a slipped fill logs SLIPPAGE_EXCEEDED and still records the position', async () => {
    const { client, inserted } = makeSupabase({ broker_accounts: () => ({ data: [{ id: 'ba-1' }] }) });
    const placement = makePlacement({ status: 'FILLED', orderId: 'ord-1', brokerTradeId: 'T1', fillPrice: 2001.2 }); // slip 1.2 > 0.5
    const svc = new ExecutionService(client, adapter, makeRisk(), placement, ready(true));

    const out = await svc.executeSignal(coreSignal);
    expect(out.executed).toBe(true); // order STANDS
    expect(inserted.risk_events?.some((r) => r.event_type === 'SLIPPAGE_EXCEEDED')).toBe(true);
    const pos = inserted.positions?.[0];
    expect(pos.slippage_points).toBeCloseTo(1.2, 4);
    expect(pos.achieved_rr).toBeGreaterThan(0); // recomputed from the actual fill
  });
});

describe('pre-order gates: stale signals and entry drift', () => {
  const OLD = { ...process.env };
  beforeEach(() => { delete process.env.AUTO_TRADE_ENABLED; delete process.env.MAX_SLIPPAGE_POINTS; });
  afterEach(() => (process.env = { ...OLD }));

  const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();
  const withBroker = (bid: number, ask: number) => ({ ...adapter, getPricing: jest.fn(async () => quote(bid, ask)) });
  const run = async (sig: any, broker: any = adapter, handlers: Record<string, () => any> = {}) => {
    const db = makeSupabase({ broker_accounts: () => ({ data: [{ id: 'ba-1' }] }), ...handlers });
    const risk = makeRisk();
    const placement = makePlacement();
    const out = await new ExecutionService(db.client, broker, risk, placement, ready(true)).executeSignal(sig);
    return { out, risk, placement, db, events: db.inserted.risk_events ?? [] };
  };

  it('rejects a signal 59h old (the real 13 Jul case) before risk or ordering, and logs it', async () => {
    const { out, risk, placement, events } = await run({ ...coreSignal, timeframe: '1h', created_at: hoursAgo(59) });
    expect(out).toMatchObject({ executed: false, reason: 'signal_stale' });
    expect(risk.assess).not.toHaveBeenCalled();
    expect(placement.placeForSignal).not.toHaveBeenCalled();
    expect(events[0]).toMatchObject({ event_type: 'SIGNAL_STALE', signal_id: 'sig-1' });
  });

  it.each([
    ['1h', 0.9, true],
    ['1h', 1.1, false],
    ['4h', 3.9, true],
    ['4h', 4.1, false],
  ])('a %s signal aged %sh: executed=%s', async (timeframe, age, executed) => {
    const { out } = await run({ ...coreSignal, timeframe, created_at: hoursAgo(age as number) });
    expect(out.executed).toBe(executed);
  });

  it('rejects a signal with no usable timestamp rather than trading it', async () => {
    const { out } = await run({ ...coreSignal, created_at: undefined });
    expect(out).toMatchObject({ executed: false, reason: 'signal_stale' });
  });

  // coreSignal: entry 2000, stop 1991.6, so 1R = 8.4 and the default 0.1R limit = 0.84.
  const sell = { ...coreSignal, direction: 'SELL', stop_loss: 2008.4, take_profit: 1983.2 };

  describe.each([
    ['BUY', coreSignal, { adverse009: [2000.4, 2000.756], adverse011: [2000.6, 2000.924], favourable05: [1995.5, 1995.8] }],
    ['SELL', sell, { adverse009: [1999.244, 1999.5], adverse011: [1999.076, 1999.4], favourable05: [2004.2, 2004.5] }],
  ])('%s one-sided drift', (_side, sig, q) => {
    it('allows 0.09R of adverse drift', async () => {
      const { out, placement } = await run(sig, withBroker(q.adverse009[0], q.adverse009[1]));
      expect(out.executed).toBe(true);
      expect(placement.placeForSignal).toHaveBeenCalled();
    });

    it('rejects 0.11R of adverse drift BEFORE ordering, and logs it', async () => {
      const { out, placement, events } = await run(sig, withBroker(q.adverse011[0], q.adverse011[1]));
      expect(out).toMatchObject({ executed: false, reason: 'entry_drift' });
      expect(placement.placeForSignal).not.toHaveBeenCalled();
      expect(events[0]).toMatchObject({ event_type: 'ENTRY_DRIFT_EXCEEDED', signal_id: 'sig-1' });
    });

    it('allows 0.5R of favourable drift', async () => {
      const { out, placement, events } = await run(sig, withBroker(q.favourable05[0], q.favourable05[1]));
      expect(out.executed).toBe(true);
      expect(placement.placeForSignal).toHaveBeenCalled();
      expect(events).toHaveLength(0);
    });

    it('an empty quote is not a better price: rejected, never ordered, and logged', async () => {
      const { out, placement, events } = await run(sig, withBroker(0, 0));
      expect(out).toMatchObject({ executed: false, reason: 'quote_unavailable' });
      expect(placement.placeForSignal).not.toHaveBeenCalled();
      expect(events[0]).toMatchObject({ event_type: 'ENTRY_QUOTE_UNAVAILABLE', signal_id: 'sig-1' });
    });
  });

  it('scales with the signal stop distance', async () => {
    const wide = { ...coreSignal, stop_loss: 1960 }; // 1R = 40, limit 4
    expect((await run(wide, withBroker(2003.5, 2003.9))).out.executed).toBe(true);
    expect((await run(wide, withBroker(2003.9, 2004.1))).out.reason).toBe('entry_drift');
  });

  it('MAX_SLIPPAGE_POINTS no longer affects the gate', async () => {
    process.env.MAX_SLIPPAGE_POINTS = '0.01';
    expect((await run(coreSignal, withBroker(2000.4, 2000.756))).out.executed).toBe(true);
  });

  it('ENTRY_DRIFT_MAX_R overrides the default', async () => {
    process.env.ENTRY_DRIFT_MAX_R = '0.2'; // limit 1.68
    expect((await run(coreSignal, withBroker(2000.4, 2001.5))).out.executed).toBe(true);
    delete process.env.ENTRY_DRIFT_MAX_R;
  });

  it('logs once per signal: the 2 minute poll retries it without another risk_event', async () => {
    const { events } = await run(
      { ...coreSignal, created_at: hoursAgo(59) }, adapter,
      { risk_events: () => ({ data: [{ id: 1 }] }) },
    );
    expect(events).toHaveLength(0);
  });

  it('the poll reads created_at, which the stale gate depends on', async () => {
    const db = makeSupabase({ signals: () => ({ data: [] }) });
    await new ExecutionService(db.client, adapter, makeRisk(), makePlacement(), ready(true)).pollNewSignals();
    expect(db.selects.signals).toContain('created_at');
  });
});

describe('time stop stores the broker close time', () => {
  it('uses the close time from the broker as closed_at', async () => {
    const OLD = { ...process.env };
    process.env.OANDA_ACCOUNT_ID_DEMO = 'test-001';
    const now = new Date('2026-07-20T12:00:00Z');
    const position = { id: 'pos-1', broker_trade_id: 'T1', opened_at: '2026-07-06T12:00:00Z', entry_price: 2000, initial_stop_loss: 1990, stop_loss: 1990, side: 'BUY' };
    const { client, updated } = makeSupabase({ positions: () => ({ data: [position] }) });
    const broker = { closeTrade: jest.fn(async () => ({ closed: true })), getTrade: jest.fn(async () => ({ closePrice: 2005, closeTime: '2026-07-20T11:59:58.000Z' })) } as any;

    await new ExecutionService(client, broker, makeRisk(), makePlacement(), ready(true)).checkTimeStops(now);

    expect(updated.positions?.[0]).toMatchObject({ close_reason: 'TIME_STOP', closed_at: '2026-07-20T11:59:58.000Z' });
    process.env = { ...OLD };
  });
});
