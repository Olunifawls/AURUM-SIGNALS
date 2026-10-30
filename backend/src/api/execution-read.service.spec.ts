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
