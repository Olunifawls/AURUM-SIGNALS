import { AdminResetController } from './admin-reset.controller';

const makeSvc = () => ({ ledgerReset: jest.fn().mockResolvedValue({ flattenedTrades: 0, openTradesAfter: 0, wipedCounts: {}, haltsCleared: 0, baselineEquity: 10000, baselineCcy: 'GBP', ts: '2026-07-09T00:00:00.000Z' }) });
const makeBreakers = () => ({ testFireBreaker: jest.fn().mockResolvedValue(null) } as any);
const makeRisk = () => ({ assess: jest.fn().mockResolvedValue({ approved: false, reason: 'VOLATILITY_COOLDOWN', events: [] }) } as any);

describe('AdminResetController — live-mode guard', () => {
  const OLD = { ...process.env };
  afterEach(() => { process.env = { ...OLD }; });

  it('HARD-REFUSES when TRADING_MODE=live (never wipes real money)', async () => {
    process.env.TRADING_MODE = 'live';
    const ctrl = new AdminResetController(makeSvc() as any, makeBreakers(), makeRisk());
    const svc = (ctrl as any).svc;
    const result = await ctrl.ledgerReset({ confirm: 'WIPE_LEDGER_DEMO' });
    expect(result).toMatchObject({ ok: false });
    expect((result as any).error).toMatch(/REFUSED.*live/i);
    expect(svc.ledgerReset).not.toHaveBeenCalled();
  });

  it('refuses without the confirm body regardless of mode', async () => {
    process.env.TRADING_MODE = 'demo';
    const ctrl = new AdminResetController(makeSvc() as any, makeBreakers(), makeRisk());
    const result = await ctrl.ledgerReset({});
    expect(result).toMatchObject({ ok: false });
    expect((result as any).error).toMatch(/WIPE_LEDGER_DEMO/);
  });

  it('proceeds when TRADING_MODE=demo and confirm is correct', async () => {
    process.env.TRADING_MODE = 'demo';
    const svc = makeSvc();
    const ctrl = new AdminResetController(svc as any, makeBreakers(), makeRisk());
    const result = await ctrl.ledgerReset({ confirm: 'WIPE_LEDGER_DEMO' });
    expect(result).toMatchObject({ ok: true, baselineEquity: 10000 });
    expect(svc.ledgerReset).toHaveBeenCalledTimes(1);
  });

  it('proceeds when TRADING_MODE is unset (defaults to demo)', async () => {
    delete process.env.TRADING_MODE;
    const svc = makeSvc();
    const ctrl = new AdminResetController(svc as any, makeBreakers(), makeRisk());
    const result = await ctrl.ledgerReset({ confirm: 'WIPE_LEDGER_DEMO' });
    expect(result).toMatchObject({ ok: true });
    expect(svc.ledgerReset).toHaveBeenCalledTimes(1);
  });
});
