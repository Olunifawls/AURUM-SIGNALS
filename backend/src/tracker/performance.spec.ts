import { computePerformanceDaily, maxLosingStreak, RollupInput } from './performance';

// A mixed, hand-verifiable set: 2 generated day1 (win+loss resolved day2),
// 2 generated day2 (a win resolved day3, an EXPIRED resolved day5).
const rows: RollupInput[] = [
  { createdDate: '2024-01-01', resolvedDate: '2024-01-02', status: 'HIT_TP', rMultiple: 2 },
  { createdDate: '2024-01-01', resolvedDate: '2024-01-02', status: 'HIT_SL', rMultiple: -1 },
  { createdDate: '2024-01-02', resolvedDate: '2024-01-03', status: 'HIT_TP', rMultiple: 2 },
  { createdDate: '2024-01-02', resolvedDate: '2024-01-05', status: 'EXPIRED', rMultiple: 0.5 },
];

describe('(f) computePerformanceDaily — hand-verified', () => {
  const perf = computePerformanceDaily(rows);
  const byDay = Object.fromEntries(perf.map((p) => [p.day, p]));

  it('emits a row per day with generation or resolution', () => {
    expect(perf.map((p) => p.day)).toEqual(['2024-01-01', '2024-01-02', '2024-01-03', '2024-01-05']);
  });

  it('day 1: 2 generated, nothing resolved, null rates, cumulative 0', () => {
    expect(byDay['2024-01-01']).toMatchObject({
      signals_generated: 2,
      wins: 0,
      losses: 0,
      expired: 0,
      win_rate: null,
      avg_rr_achieved: null,
      cumulative_r: 0,
    });
  });

  it('day 2: 2 generated, 1 win + 1 loss, win_rate 50, avg_rr 0.5, cumulative 1', () => {
    expect(byDay['2024-01-02']).toMatchObject({
      signals_generated: 2,
      wins: 1,
      losses: 1,
      expired: 0,
      win_rate: 50,
      avg_rr_achieved: 0.5,
      cumulative_r: 1,
    });
  });

  it('day 3: 1 win resolved, win_rate 100, avg_rr 2, cumulative 3', () => {
    expect(byDay['2024-01-03']).toMatchObject({
      signals_generated: 0,
      wins: 1,
      losses: 0,
      win_rate: 100,
      avg_rr_achieved: 2,
      cumulative_r: 3,
    });
  });

  it('day 5: EXPIRED excluded from win_rate but in avg_rr; cumulative 3.5', () => {
    expect(byDay['2024-01-05']).toMatchObject({
      signals_generated: 0,
      wins: 0,
      losses: 0,
      expired: 1,
      win_rate: null, // decisive outcomes = 0
      avg_rr_achieved: 0.5, // EXPIRED R included
      cumulative_r: 3.5,
    });
  });
});

describe('maxLosingStreak', () => {
  it('finds the longest run of consecutive HIT_SL in resolution order', () => {
    expect(
      maxLosingStreak(['HIT_SL', 'HIT_SL', 'HIT_TP', 'HIT_SL', 'HIT_SL', 'HIT_SL', 'HIT_TP']),
    ).toBe(3);
  });

  it('is 0 with no losses and counts a trailing streak', () => {
    expect(maxLosingStreak(['HIT_TP', 'EXPIRED', 'HIT_TP'])).toBe(0);
    expect(maxLosingStreak(['HIT_TP', 'HIT_SL', 'HIT_SL'])).toBe(2);
  });
});
