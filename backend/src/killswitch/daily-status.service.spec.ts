import { DailyStatusService } from './daily-status.service';

const NOW = new Date('2026-10-30T08:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86400_000).toISOString();

function makeSupabase(rows: any[], error: { message: string } | null = null) {
  const b: any = {
    select: () => b,
    order: () => b,
    limit: () => Promise.resolve({ data: error ? null : rows, error }),
  };
  return { from: () => b } as any;
}

const make = (opts: { halts?: any[]; rows?: any[]; error?: { message: string } }) => {
  const state = { getActiveHalts: jest.fn(async () => opts.halts ?? []) } as any;
  const alerts = { send: jest.fn(async () => true) } as any;
  return { svc: new DailyStatusService(makeSupabase(opts.rows ?? [], opts.error ?? null), state, alerts), alerts };
};

const halt = { halt_type: 'CONSECUTIVE_SL', reason: '4 consecutive SL hits', requires_manual: true };

describe('DailyStatusService', () => {
  it('sends while a halt is active, naming the halt and reason', async () => {
    const { svc, alerts } = make({ halts: [halt], rows: [{ opened_at: daysAgo(1) }] });
    await svc.sendDailyStatus(NOW);
    expect(alerts.send).toHaveBeenCalledTimes(1);
    expect(alerts.send.mock.calls[0][0]).toContain('CONSECUTIVE_SL: 4 consecutive SL hits');
  });

  it('sends when no trade has been placed in 7 days, even with no halt', async () => {
    const { svc, alerts } = make({ rows: [{ opened_at: daysAgo(7) }] });
    await svc.sendDailyStatus(NOW);
    expect(alerts.send.mock.calls[0][0]).toContain('7 days ago');
  });

  it('sends when no trade has ever been placed', async () => {
    const { svc, alerts } = make({ rows: [] });
    await svc.sendDailyStatus(NOW);
    expect(alerts.send.mock.calls[0][0]).toContain('no trades recorded');
  });

  it('stays quiet when there is no halt and a trade within 7 days', async () => {
    const { svc, alerts } = make({ rows: [{ opened_at: daysAgo(6) }] });
    await svc.sendDailyStatus(NOW);
    expect(alerts.send).not.toHaveBeenCalled();
  });

  it('does not report "no trades" when the query failed', async () => {
    const { svc, alerts } = make({ error: { message: 'db down' } });
    await svc.sendDailyStatus(NOW);
    expect(alerts.send).not.toHaveBeenCalled();
  });
});
