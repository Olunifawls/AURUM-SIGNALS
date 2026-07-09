import { WeeklyReportService } from './weekly-report.service';

const NOW = new Date('2026-07-06T18:00:00Z'); // Sunday 18:00 UTC

// Returns a Supabase mock that queues responses per table.
// Each successive call to from(table) pops the next response in that table's queue.
function makeSupabase(queues: Record<string, any[]> = {}) {
  const callIdx: Record<string, number> = {};
  const defaults: Record<string, any[]> = {
    positions: [
      // call 1: resolved trades this week
      { data: [
        { realized_r: 2.0, realized_pl: 180, side: 'BUY', mode: 'demo' },
        { realized_r: -1.0, realized_pl: -90, side: 'SELL', mode: 'demo' },
        { realized_r: 1.5, realized_pl: 130, side: 'BUY', mode: 'demo' },
      ]},
      // call 2: all-time count (head=true so .count not .data)
      { data: null, count: 7 },
      // call 3: open now
      { data: [{ id: 'p1', side: 'BUY', mode: 'demo' }] },
    ],
    risk_events: [
      { data: [
        { event_type: 'TRADING_HALTED', message: 'FEED_STALE: stale', created_at: NOW.toISOString() },
        { event_type: 'TRADING_HALTED', message: 'VOLATILITY_COOLDOWN: spike', created_at: NOW.toISOString() },
      ]},
    ],
    equity_snapshots: [
      // call 1: WEEKLY_REF
      { data: [{ equity: 10000, ts: '2026-06-30T00:00:00Z' }] },
      // call 2: HWM
      { data: [{ high_water_mark: 10500 }] },
    ],
    signals: [
      // call 1: this week (no .in filter)
      { data: [{ id: 's1', status: 'OPEN' }, { id: 's2', status: 'HIT_TP' }] },
      // call 2: all-time resolved (.in filter applied)
      { data: [
        { id: 'a1', status: 'HIT_TP' }, { id: 'a2', status: 'HIT_TP' },
        { id: 'a3', status: 'HIT_SL' }, { id: 'a4', status: 'HIT_TP' },
      ]},
    ],
    ...queues,
  };

  const from = jest.fn().mockImplementation((table: string) => {
    callIdx[table] = (callIdx[table] ?? 0);
    const queue = defaults[table] ?? [{ data: [], count: 0 }];
    const idx = callIdx[table]++;
    const response = queue[idx] ?? queue[queue.length - 1] ?? { data: [], count: 0 };
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      gte: () => chain,
      in: () => chain,
      order: () => chain,
      limit: () => chain,
      then: (resolve: (v: any) => any) => Promise.resolve(response).then(resolve),
    };
    return chain;
  });

  return { from } as any;
}

const makeBroker = () => ({
  getAccount: jest.fn().mockResolvedValue({ currency: 'GBP', equity: 10200, unrealizedPl: 45 }),
});
const makeAlerts = () => ({ send: jest.fn().mockResolvedValue(true) });

describe('WeeklyReportService.buildReport', () => {
  it('includes all required sections and correct trade stats', async () => {
    const svc = new WeeklyReportService(makeSupabase() as any, makeBroker() as any, makeAlerts() as any);
    const report = await svc.buildReport(NOW);

    // Trade section
    expect(report).toMatch(/Trades: 3/);
    expect(report).toMatch(/Win \/ Loss \/ B\/E: 2 \/ 1 \/ 0/);
    expect(report).toMatch(/Win rate: 66\.7%/);
    expect(report).toMatch(/Cumulative R:/);
    expect(report).toMatch(/Best:.*\+2\.00R/);
    expect(report).toMatch(/Worst:.*-1\.00R/);

    // P/L section
    expect(report).toMatch(/Realized P\/L \(week\)/);
    expect(report).toMatch(/Open positions: 1/);
    expect(report).toMatch(/Unrealised P\/L.*\+45/);

    // Equity section
    expect(report).toMatch(/Start of week.*10000\.00 GBP/);
    expect(report).toMatch(/Current.*10200\.00 GBP/);
    expect(report).toMatch(/HWM.*10500\.00 GBP/);
    expect(report).toMatch(/Max drawdown/);

    // Kill-switch section
    expect(report).toMatch(/FEED_STALE.*1×/);
    expect(report).toMatch(/VOLATILITY_COOLDOWN.*1×/);
    expect(report).toMatch(/Total: 2/);

    // Go-live gate
    expect(report).toMatch(/Resolved demo trades: 7 \/ 30/);

    // L1 signals
    expect(report).toMatch(/Signals this week: 2/);
    expect(report).toMatch(/Win rate.*75\.0%.*3\/4/);

    // Disclaimer
    expect(report).toMatch(/Demo results only\. Not financial advice\./);
  });

  it('handles empty week gracefully (no trades, no halts)', async () => {
    const sb = makeSupabase({
      positions: [
        { data: [] },
        { data: null, count: 0 },
        { data: [] },
      ],
      risk_events: [{ data: [] }],
      signals: [{ data: [] }, { data: [] }],
    });
    const svc = new WeeklyReportService(sb as any, makeBroker() as any, makeAlerts() as any);
    const report = await svc.buildReport(NOW);
    expect(report).toMatch(/Trades: 0/);
    expect(report).toMatch(/None/);
    expect(report).toMatch(/Signals this week: 0/);
    expect(report).toMatch(/Demo results only/);
  });

  it('handles null supabase gracefully', async () => {
    const svc = new WeeklyReportService(null as any, makeBroker() as any, makeAlerts() as any);
    const report = await svc.buildReport(NOW);
    expect(report).toBe('(no database)');
  });
});
