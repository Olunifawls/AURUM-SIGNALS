import { ExecutionReadService } from './execution-read.service';

describe('ExecutionReadService.setManualHalt', () => {
  it('a halt from the Execution page sends a Telegram alert', async () => {
    const state = { setHalt: jest.fn(async () => undefined) };
    const alerts = { sendHaltAlert: jest.fn(async () => true) };
    const svc = new (ExecutionReadService as any)({}, {}, state, alerts);

    await svc.setManualHalt();

    expect(state.setHalt).toHaveBeenCalledWith('MANUAL_HALT', expect.objectContaining({ requiresManual: true }));
    expect(alerts.sendHaltAlert).toHaveBeenCalledWith('MANUAL_HALT', 'manual halt (Execution page)');
  });
});

describe('ExecutionReadService.closeTrade', () => {
  it('stores the broker close time as closed_at', async () => {
    const position = { id: 'pos-1', entry_price: 2000, stop_loss: 1990, take_profit: 2020, side: 'BUY', mode: 'demo' };
    const updates: any[] = [];
    const b: any = {
      select: () => b,
      eq: () => b,
      limit: () => Promise.resolve({ data: [position] }),
      update: (fields: any) => { updates.push(fields); return { eq: () => Promise.resolve({ error: null }) }; },
      insert: () => Promise.resolve({ error: null }),
    };
    const broker = {
      closeTrade: jest.fn(async () => ({ closed: true })),
      getTrade: jest.fn(async () => ({ closePrice: 2005, realizedPl: 5, closeTime: '2026-07-17T13:38:41.000Z' })),
    };
    const svc = new (ExecutionReadService as any)({ from: () => b }, broker, {}, {});

    await svc.closeTrade('T1');

    expect(updates[0]).toMatchObject({ close_reason: 'MANUAL', closed_at: '2026-07-17T13:38:41.000Z' });
  });
});
