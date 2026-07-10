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
    const a = new AlertsService(null as never, null as never);
    const send = jest.spyOn(a, 'send').mockResolvedValue(true);
    expect(await a.sendResolution(res('experimental', '15min'))).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it('ALERT_15MIN off: a CORE close alert still sends', async () => {
    process.env.ALERT_15MIN = 'false';
    const a = new AlertsService(null as never, null as never);
    const send = jest.spyOn(a, 'send').mockResolvedValue(true);
    expect(await a.sendResolution(res('core', '4h'))).toBe(true);
    expect(send).toHaveBeenCalled();
  });

  it('ALERT_15MIN on: an experimental close alert sends', async () => {
    process.env.ALERT_15MIN = 'true';
    const a = new AlertsService(null as never, null as never);
    const send = jest.spyOn(a, 'send').mockResolvedValue(true);
    expect(await a.sendResolution(res('experimental', '15min'))).toBe(true);
    expect(send).toHaveBeenCalled();
  });
});

// ─── heartbeatCheck — shared market-tradeable gate ───────────────────────────

// Wednesday 12:00 UTC — market open, tradeable
const NOW = new Date('2026-07-09T12:00:00Z');

// bar opened 36 min ago → barClose = 36m ago + 15m = 21 min ago → STALE (>20 min)
const STALE_TS = new Date(NOW.getTime() - 36 * 60_000).toISOString();
// bar opened 14 min ago → barClose = 14m ago + 15m = 1 min in future → NOT stale
const FRESH_TS = new Date(NOW.getTime() - 14 * 60_000).toISOString();

function makeSupabase(barOpenTs: string | null) {
  const data = barOpenTs ? [{ ts: barOpenTs }] : [];
  const chain: any = {
    select: () => chain,
    eq: () => chain,
    order: () => chain,
    limit: () => Promise.resolve({ data, error: null }),
    insert: () => Promise.resolve({ error: null }),
  };
  return { from: jest.fn(() => chain) } as any;
}

function makeBroker(tradeable = true) {
  return {
    getPricing: jest.fn(async () => ({ instrument: 'XAU/USD', bid: 4100, ask: 4100.5, spread: 0.5, tradeable })),
  } as any;
}

describe('AlertsService.heartbeatCheck — shared market-tradeable gate', () => {
  afterEach(() => { jest.restoreAllMocks(); });

  it('sends DATA FEED DOWN when market open, tradeable, and bar closed >20 min ago', async () => {
    const svc = new AlertsService(makeSupabase(STALE_TS), makeBroker(true));
    const sendSpy = jest.spyOn(svc, 'send').mockResolvedValue(true);
    await svc.heartbeatCheck(NOW);
    expect(sendSpy).toHaveBeenCalledWith(expect.stringContaining('DATA FEED DOWN'));
  });

  it('does NOT send when OANDA tradeable=false (daily maintenance break ~21:00–22:00 UTC)', async () => {
    const svc = new AlertsService(makeSupabase(STALE_TS), makeBroker(false));
    const sendSpy = jest.spyOn(svc, 'send').mockResolvedValue(true);
    await svc.heartbeatCheck(NOW);
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('does NOT send when market calendar closed (weekend) — OANDA not called at all', async () => {
    const SAT = new Date('2026-07-11T12:00:00Z'); // Saturday
    const broker = makeBroker(true);
    const svc = new AlertsService(makeSupabase(STALE_TS), broker);
    const sendSpy = jest.spyOn(svc, 'send').mockResolvedValue(true);
    await svc.heartbeatCheck(SAT);
    expect(sendSpy).not.toHaveBeenCalled();
    expect(broker.getPricing).not.toHaveBeenCalled(); // fast exit — no OANDA call on weekends
  });

  it('does NOT send when feed is fresh (<20 min since bar close)', async () => {
    const svc = new AlertsService(makeSupabase(FRESH_TS), makeBroker(true));
    const sendSpy = jest.spyOn(svc, 'send').mockResolvedValue(true);
    await svc.heartbeatCheck(NOW);
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('does NOT send when OANDA is unreachable — defensive, no false alarm', async () => {
    const failBroker = {
      getPricing: jest.fn(async () => { throw new Error('OANDA unreachable'); }),
    } as any;
    const svc = new AlertsService(makeSupabase(STALE_TS), failBroker);
    const sendSpy = jest.spyOn(svc, 'send').mockResolvedValue(true);
    await svc.heartbeatCheck(NOW);
    expect(sendSpy).not.toHaveBeenCalled();
  });
});
