import { ExecutionService, SignalForExec } from './execution.service';
import { ExecutionReadinessService } from './readiness.service';

function makeSupabase(handlers: Record<string, () => any> = {}) {
  const inserted: Record<string, any[]> = {};
  const updated: Record<string, any[]> = {};
  const from = (table: string) => {
    const term = () => Promise.resolve(handlers[table] ? handlers[table]() : { data: [] });
    const b: any = {
      select: () => b,
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
  return { client: { from } as any, inserted, updated };
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
const adapter = { closeTrade: jest.fn(), getTrade: jest.fn() } as any;

const coreSignal: SignalForExec = { id: 'sig-1', timeframe: '4h', direction: 'BUY', entry_price: 2000, stop_loss: 1991.6, take_profit: 2016.8, track: 'core', status: 'OPEN' };

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
