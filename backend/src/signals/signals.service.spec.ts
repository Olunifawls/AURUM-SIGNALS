import { SignalsService } from './signals.service';

const result = { direction: 'BUY', levels: { entry: 2000, stop: 1990, takeProfit: 2020 } } as any;

describe('SignalsService V1 evaluation', () => {
  const make = (chief: any) => {
    const events = { warn: jest.fn(async () => undefined), info: jest.fn(async () => undefined) } as any;
    return { svc: new SignalsService(null, events, {} as any, {} as any, chief) as any, events };
  };

  it('passes the stored signal to the chief analyst', async () => {
    const chief = { evaluate: jest.fn(async () => ({ eligible: true })) };
    const { svc } = make(chief);
    await expect(svc.evaluateV1('sig-1', '4h', result)).resolves.toEqual({ eligible: true });
    expect(chief.evaluate).toHaveBeenCalledWith('sig-1', expect.objectContaining({ timeframe: '4h', direction: 'BUY', entry: 2000, stop: 1990, target: 2020 }));
  });

  it('a chief-analyst failure is logged and never reaches L1', async () => {
    const { svc, events } = make({ evaluate: jest.fn(async () => { throw new Error('db down'); }) });
    await expect(svc.evaluateV1('sig-1', '4h', result)).resolves.toBeNull();
    expect(events.warn).toHaveBeenCalledWith('signals', expect.stringContaining('cannot execute'), expect.anything());
  });
});
