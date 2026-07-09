import { BreakevenStopService } from './breakeven-stop.service';

const SYMBOL = 'XAU/USD';

const makeSupabase = (positions: object[]) => {
  const select = jest.fn().mockReturnThis();
  const eq = jest.fn().mockReturnThis();
  const update = jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ data: null, error: null }) });
  const insert = jest.fn().mockResolvedValue({ data: null, error: null });
  const from = jest.fn().mockImplementation((table: string) => {
    if (table === 'positions') {
      return {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        // Terminal resolver: return positions
        then: (resolve: (v: any) => any) => Promise.resolve({ data: positions }).then(resolve),
        update: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ data: null, error: null }) }),
      };
    }
    return { insert: jest.fn().mockResolvedValue({ data: null, error: null }) };
  });
  // Make the select chain awaitable
  const posChain = { select, eq, then: (r: (v: any) => any) => Promise.resolve({ data: positions }).then(r), update };
  select.mockReturnValue(posChain);
  eq.mockReturnValue(posChain);
  return { from } as any;
};

const makeBroker = (mid = 3310) => ({
  getPricing: jest.fn().mockResolvedValue({ bid: mid - 0.15, ask: mid + 0.15, spread: 0.3 }),
  modifyTradeSL: jest.fn().mockResolvedValue({ modified: true }),
});

const OLD_ENV = { ...process.env };

beforeAll(() => {
  process.env.OANDA_ACCOUNT_ID_DEMO = 'test-001';
  process.env.BREAKEVEN_STOP_ENABLED = 'true';
  process.env.BREAKEVEN_BUFFER_POINTS = '0.1';
  process.env.TRADING_MODE = 'demo';
});
afterAll(() => { process.env = OLD_ENV; });

function makeService(positions: object[], mid = 3310) {
  const sb = makeSupabase(positions);
  const broker = makeBroker(mid);
  const svc = new BreakevenStopService(sb, broker as any);
  return { svc, sb, broker };
}

describe('BreakevenStopService', () => {
  describe('BUY trade', () => {
    const BUY_POS = {
      id: 'pos-1',
      mode: 'demo',
      side: 'BUY',
      entry_price: 3300,
      stop_loss: 3290,   // 10pt stop distance
      broker_trade_id: 'T001',
      meta: null,
    };

    it('moves SL to breakeven when price >= entry + stopDist (+1R)', async () => {
      // mid=3310 == entry + stopDist (3300 + 10) → exactly at +1R
      const { svc, broker } = makeService([BUY_POS], 3310);
      const moved = await svc.checkBreakeven();
      expect(moved).toBe(1);
      expect(broker.modifyTradeSL).toHaveBeenCalledWith('T001', 3300.1); // entry + 0.1 buffer
    });

    it('moves SL when price > entry + stopDist (above +1R)', async () => {
      const { svc, broker } = makeService([BUY_POS], 3315);
      const moved = await svc.checkBreakeven();
      expect(moved).toBe(1);
      expect(broker.modifyTradeSL).toHaveBeenCalledWith('T001', 3300.1);
    });

    it('does NOT move SL when price < entry + stopDist (below +1R)', async () => {
      // mid=3309.9: just below +1R threshold
      const { svc, broker } = makeService([BUY_POS], 3309.9);
      const moved = await svc.checkBreakeven();
      expect(moved).toBe(0);
      expect(broker.modifyTradeSL).not.toHaveBeenCalled();
    });
  });

  describe('SELL trade', () => {
    const SELL_POS = {
      id: 'pos-2',
      mode: 'demo',
      side: 'SELL',
      entry_price: 3300,
      stop_loss: 3310,   // 10pt stop distance (SL above entry for short)
      broker_trade_id: 'T002',
      meta: null,
    };

    it('moves SL to breakeven when price <= entry - stopDist (+1R for SELL)', async () => {
      // mid=3290 == entry - stopDist (3300 - 10) → exactly at +1R
      const { svc, broker } = makeService([SELL_POS], 3290);
      const moved = await svc.checkBreakeven();
      expect(moved).toBe(1);
      expect(broker.modifyTradeSL).toHaveBeenCalledWith('T002', 3299.9); // entry - 0.1 buffer
    });

    it('does NOT move SL when price > entry - stopDist (below +1R for SELL)', async () => {
      const { svc, broker } = makeService([SELL_POS], 3290.1);
      const moved = await svc.checkBreakeven();
      expect(moved).toBe(0);
      expect(broker.modifyTradeSL).not.toHaveBeenCalled();
    });
  });

  it('is idempotent: skips position with meta.breakevenStopSet=true', async () => {
    const pos = {
      id: 'pos-3', mode: 'demo', side: 'BUY',
      entry_price: 3300, stop_loss: 3300.1,
      broker_trade_id: 'T003',
      meta: { breakevenStopSet: true },
    };
    const { svc, broker } = makeService([pos], 3320);
    const moved = await svc.checkBreakeven();
    expect(moved).toBe(0);
    expect(broker.modifyTradeSL).not.toHaveBeenCalled();
  });

  it('skips positions with no broker_trade_id', async () => {
    const pos = {
      id: 'pos-4', mode: 'demo', side: 'BUY',
      entry_price: 3300, stop_loss: 3290,
      broker_trade_id: null,
      meta: null,
    };
    const { svc, broker } = makeService([pos], 3320);
    const moved = await svc.checkBreakeven();
    expect(moved).toBe(0);
    expect(broker.modifyTradeSL).not.toHaveBeenCalled();
  });

  it('returns 0 and does nothing when BREAKEVEN_STOP_ENABLED=false', async () => {
    process.env.BREAKEVEN_STOP_ENABLED = 'false';
    const { svc, broker } = makeService([{
      id: 'p5', mode: 'demo', side: 'BUY', entry_price: 3300, stop_loss: 3290,
      broker_trade_id: 'T005', meta: null,
    }], 3320);
    const moved = await svc.checkBreakeven();
    expect(moved).toBe(0);
    expect(broker.modifyTradeSL).not.toHaveBeenCalled();
    process.env.BREAKEVEN_STOP_ENABLED = 'true';
  });
});
