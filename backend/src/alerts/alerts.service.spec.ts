import { AlertsService } from './alerts.service';
import { AlertResolution } from './alert-format';

const res = (track: 'core' | 'experimental', timeframe: string): AlertResolution => ({
  status: 'HIT_TP',
  direction: 'BUY',
  timeframe,
  entry: 2341.2,
  rMultiple: 2.0,
  track,
});

describe('resolution/close alert respects the SAME experimental gate as new-signal', () => {
  const OLD = { ...process.env };
  afterEach(() => {
    process.env = { ...OLD };
    jest.restoreAllMocks();
  });

  it('ALERT_15MIN off: an EXPERIMENTAL close alert is suppressed (no send)', async () => {
    process.env.ALERT_15MIN = 'false';
    const a = new AlertsService(null as never);
    const send = jest.spyOn(a, 'send').mockResolvedValue(true);
    expect(await a.sendResolution(res('experimental', '15min'))).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it('ALERT_15MIN off: a CORE close alert still sends', async () => {
    process.env.ALERT_15MIN = 'false';
    const a = new AlertsService(null as never);
    const send = jest.spyOn(a, 'send').mockResolvedValue(true);
    expect(await a.sendResolution(res('core', '4h'))).toBe(true);
    expect(send).toHaveBeenCalled();
  });

  it('ALERT_15MIN on: an experimental close alert sends', async () => {
    process.env.ALERT_15MIN = 'true';
    const a = new AlertsService(null as never);
    const send = jest.spyOn(a, 'send').mockResolvedValue(true);
    expect(await a.sendResolution(res('experimental', '15min'))).toBe(true);
    expect(send).toHaveBeenCalled();
  });
});
