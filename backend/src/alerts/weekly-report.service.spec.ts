import { SCHEDULE_CRON_OPTIONS } from '@nestjs/schedule/dist/schedule.constants';
import { CronJob } from 'cron';
import { WeeklyReportService } from './weekly-report.service';

const payload = (over: any = {}) =>
  ({
    asOf: '2026-11-01T17:00:00.000Z',
    ruleset: 'v1',
    demoTrades: {
      thisWeek: { count: 3, winRatePct: 66.7, totalR: 2.5, avgSlippagePoints: 0.12 },
      sinceV1: { count: 3, winRatePct: 66.7, totalR: 2.5, avgSlippagePoints: 0.12 },
    },
    kept: { count: 2, resolved: 2, winRatePct: 50, totalR: 1 },
    vetoed: { count: 5, resolved: 4, winRatePct: 25, totalR: -1 },
    raw: { kept: { signals: 3, totalR: 3 }, vetoed: { signals: 6, totalR: -2 } },
    newsExit: { settled: 0, exitR: 0, holdR: 0 },
    thesisWatch: { events: 0, settled: 0, actedR: 0, heldR: 0 },
    dollarShock: { events: 0, settled: 0, actedR: 0, heldR: 0 },
    setups: 9,
    duplicates: 3,
    nonTradeable: { total: 2, byReason: {} },
    activeHalts: [],
    errorsThisWeek: 0,
    gate: { weeksSinceV1: 1, weeksRequired: 8, demoTrades: 3, demoTradesRequired: 30 },
    calendarDaysLeft: 100,
    account: { ccy: 'GBP', equity: 2000, startOfWeekEquity: 1950, highWaterMark: 2050, openPositions: 0, maxDrawdownPct: 2.44 },
    ...over,
  }) as any;

const make = (latest: any = null) => {
  const snapshots = {
    write: jest.fn(async () => ({ createdAt: 'x', payload: payload() })),
    build: jest.fn(async () => payload({ duplicates: 8 })),
    latest: jest.fn(async () => latest),
  };
  const alerts = { send: jest.fn(async () => true) };
  return { snapshots, alerts, svc: new WeeklyReportService({} as any, alerts as any, snapshots as any) };
};

describe('WeeklyReportService', () => {
  it('writes one snapshot and sends that snapshot', async () => {
    const { svc, snapshots, alerts } = make();
    await svc.scheduledReport();
    expect(snapshots.write).toHaveBeenCalledTimes(1);
    expect(alerts.send).toHaveBeenCalledTimes(1);
    expect((alerts.send.mock.calls as any)[0][0]).toContain('Setups 9, duplicates 3, non-tradeable 2');
  });

  it('sends nothing if the snapshot fails, and does not throw', async () => {
    const { svc, snapshots, alerts } = make();
    snapshots.write.mockRejectedValueOnce(new Error('db down'));
    await expect(svc.scheduledReport()).resolves.toBeUndefined();
    expect(alerts.send).not.toHaveBeenCalled();
  });

  it('/report shows the latest snapshot and writes nothing', async () => {
    const { svc, snapshots } = make({ createdAt: 'x', payload: payload({ duplicates: 4 }) });
    const text = await svc.buildReport(new Date());
    expect(text).toContain('duplicates 4');
    expect(snapshots.write).not.toHaveBeenCalled();
    expect(snapshots.build).not.toHaveBeenCalled();
  });

  it('/report before the first snapshot says so and writes nothing', async () => {
    const { svc, snapshots } = make();
    const text = await svc.buildReport(new Date());
    expect(text).toContain('No snapshot yet, live numbers');
    expect(text).toContain('duplicates 8');
    expect(snapshots.write).not.toHaveBeenCalled();
  });

  it('handles a missing database', async () => {
    const svc = new WeeklyReportService(null, {} as any, {} as any);
    await expect(svc.buildReport(new Date())).resolves.toBe('(no database)');
    await expect(svc.scheduledReport()).resolves.toBeUndefined();
  });
});

describe('weekly cron', () => {
  // The job the scheduler builds: CronJob(cronTime, onTick, onComplete, start, timeZone).
  const opts = Reflect.getMetadata(SCHEDULE_CRON_OPTIONS, WeeklyReportService.prototype.scheduledReport);
  const next = (from: string) => {
    jest.useFakeTimers({ now: new Date(from) });
    try {
      const job = new CronJob(opts.cronTime, () => undefined, null, false, opts.timeZone);
      return job.nextDate().toUTC().toISO({ suppressMilliseconds: true });
    } finally {
      jest.useRealTimers();
    }
  };

  it('is declared for Sunday 17:00 Europe/London', () => {
    expect(opts.cronTime).toBe('0 17 * * 0');
    expect(opts.timeZone).toBe('Europe/London');
  });

  it('fires at 16:00 UTC in British Summer Time', () => {
    expect(next('2026-07-01T00:00:00Z')).toBe('2026-07-05T16:00:00Z');
    expect(next('2026-10-12T00:00:00Z')).toBe('2026-10-18T16:00:00Z'); // the last Sunday before the change
  });

  it('fires at 17:00 UTC from the Sunday the clocks go back', () => {
    expect(next('2026-10-20T00:00:00Z')).toBe('2026-10-25T17:00:00Z');
    expect(next('2026-10-26T00:00:00Z')).toBe('2026-11-01T17:00:00Z');
  });

  it('fires at 16:00 UTC from the Sunday the clocks go forward', () => {
    expect(next('2027-03-15T00:00:00Z')).toBe('2027-03-21T17:00:00Z');
    expect(next('2027-03-22T00:00:00Z')).toBe('2027-03-28T16:00:00Z');
  });
});
