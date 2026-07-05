'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiGet } from '../../lib/api';
import { useSignalsRealtime } from '../../lib/useRealtime';
import { fmtPct, fmtSignedR, num } from '../../lib/format';
import { PerformanceResponse, SignalRow } from '../../lib/types';
import CumulativeRChart from '../../components/CumulativeRChart';

const MIN_SAMPLE = 30; // D8: sub-segments with n<30 are greyed + labelled

const D7_NOTE = 'Measured on feed prices, before broker spread and slippage.';
const HONEST_COPY =
  'These are the real, logged results of every signal this system has generated. Expect losing trades and losing streaks. A 45–60% win rate with 2:1 R:R is a realistic long-run outcome.';

interface Segment {
  key: string;
  n: number;
  wins: number;
  losses: number;
  winRate: number | null;
  avgR: number | null;
}

function rOf(s: SignalRow): number | null {
  const entry = num(s.entry_price);
  const stop = num(s.stop_loss);
  const pips = num(s.pips_result);
  if (entry == null || stop == null || pips == null || entry === stop) return null;
  return pips / Math.abs(entry - stop);
}

function segment(rows: SignalRow[], key: string): Segment {
  const resolved = rows.filter((r) => r.resolved_at != null);
  const wins = resolved.filter((r) => r.status === 'HIT_TP').length;
  const losses = resolved.filter((r) => r.status === 'HIT_SL').length;
  const rs = resolved.map(rOf).filter((v): v is number => v != null);
  return {
    key,
    n: resolved.length,
    wins,
    losses,
    winRate: wins + losses > 0 ? (wins / (wins + losses)) * 100 : null,
    avgR: rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : null,
  };
}

export default function PerformancePage() {
  const [perf, setPerf] = useState<PerformanceResponse | null>(null);
  const [signals, setSignals] = useState<SignalRow[]>([]);

  const load = useCallback(async () => {
    try {
      const [p, s] = await Promise.all([
        apiGet<PerformanceResponse>('api/performance'),
        apiGet<SignalRow[]>('api/signals?limit=200'),
      ]);
      setPerf(p);
      setSignals(s);
    } catch {
      /* keep last */
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  useSignalsRealtime(load);

  const core = useMemo(() => signals.filter((s) => s.track !== 'experimental'), [signals]);

  // Max drawdown (in R) from the daily cumulative-R curve (core-only, from the API).
  const maxDrawdown = useMemo(() => {
    let peak = 0;
    let dd = 0;
    for (const d of perf?.daily ?? []) {
      peak = Math.max(peak, d.cumulative_r);
      dd = Math.max(dd, peak - d.cumulative_r);
    }
    return dd;
  }, [perf]);

  // Current losing streak (trailing consecutive HIT_SL by resolution time), core-only.
  const currentStreak = useMemo(() => {
    const resolved = core
      .filter((s) => s.resolved_at != null)
      .sort((a, b) => ((a.resolved_at as string) < (b.resolved_at as string) ? 1 : -1));
    let n = 0;
    for (const s of resolved) {
      if (s.status === 'HIT_SL') n++;
      else break;
    }
    return n;
  }, [core]);

  const byTf = useMemo(
    () => ['15min', '1h', '4h', '1day'].map((tf) => segment(core.filter((s) => s.timeframe === tf), tf)),
    [core],
  );
  const byScore = useMemo(
    () => [4, 5, 6].map((sc) => segment(core.filter((s) => s.confluence_score === sc), `${sc}/6`)),
    [core],
  );

  const h = perf?.headline;
  const curve = (perf?.daily ?? []).map((d) => ({ day: d.day, value: d.cumulative_r }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Performance — the honest record</h1>
        <p className="mt-2 max-w-3xl text-sm text-neutral-400">{HONEST_COPY}</p>
        <p className="mt-1 text-xs text-neutral-500">{D7_NOTE}</p>
      </div>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Card label="Measured win rate" value={h ? fmtPct(h.win_rate) : '—'} sub="decisive trades" />
        <Card label="Total signals" value={h ? String(h.total_signals) : '—'} sub={`${h?.resolved ?? 0} resolved`} />
        <Card label="Avg R / trade" value={h?.avg_r_per_trade != null ? fmtSignedR(h.avg_r_per_trade) : '—'} />
        <Card label="Cumulative R" value={h ? fmtSignedR(h.cumulative_r) : '—'} accent={(h?.cumulative_r ?? 0) >= 0} />
        <Card label="Max drawdown" value={`−${maxDrawdown.toFixed(1)}R`} />
        <Card label="Losing streak" value={`${currentStreak} / ${h?.max_losing_streak ?? 0}`} sub="current / max" />
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-400">
          Cumulative R (honesty curve)
        </h2>
        <div className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-3">
          <CumulativeRChart points={curve} />
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <Breakdown title="By timeframe" segments={byTf} />
        <Breakdown title="By confluence score" segments={byScore} />
      </section>

      <section className="rounded-lg border border-purple-500/30 bg-purple-500/5 p-4">
        <h2 className="text-sm font-semibold text-purple-300">EXPERIMENTAL — 15min track</h2>
        <p className="mt-1 text-xs text-neutral-400">
          Excluded from the headline numbers above. Higher-risk, faster track — shown separately for
          transparency.
        </p>
        {perf && perf.experimental.total_signals > 0 ? (
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Card label="Win rate" value={fmtPct(perf.experimental.win_rate)} />
            <Card label="Signals" value={`${perf.experimental.total_signals}`} sub={`${perf.experimental.resolved} resolved`} />
            <Card label="Cumulative R" value={fmtSignedR(perf.experimental.cumulative_r)} accent={perf.experimental.cumulative_r >= 0} />
            <Card label="Max losing streak" value={`${perf.experimental.max_losing_streak}`} />
          </div>
        ) : (
          <p className="mt-3 text-xs text-neutral-600">No experimental signals logged yet.</p>
        )}
      </section>
    </div>
  );
}

function Card({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-3">
      <div className="text-xs text-neutral-500">{label}</div>
      <div className={`mt-1 text-xl font-semibold tabular-nums ${accent === undefined ? '' : accent ? 'text-green-400' : 'text-red-400'}`}>
        {value}
      </div>
      {sub && <div className="text-xs text-neutral-600">{sub}</div>}
    </div>
  );
}

function Breakdown({ title, segments, emptyLabel }: { title: string; segments: Segment[]; emptyLabel?: string }) {
  return (
    <div className="rounded-lg border border-neutral-800">
      {title && <div className="border-b border-neutral-800 px-3 py-2 text-sm font-semibold text-neutral-300">{title}</div>}
      <table className="w-full text-left text-sm">
        <thead className="text-xs uppercase text-neutral-500">
          <tr>
            {['Segment', 'n', 'Win rate', 'Avg R'].map((x) => (
              <th key={x} className="px-3 py-1.5 font-medium">
                {x}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {segments.map((s) => {
            const insufficient = s.n < MIN_SAMPLE;
            return (
              <tr key={s.key} className={insufficient ? 'text-neutral-600' : ''}>
                <td className="px-3 py-1.5">{s.key}</td>
                <td className="px-3 py-1.5 tabular-nums">{s.n}</td>
                <td className="px-3 py-1.5">
                  {insufficient ? (
                    <span className="italic">insufficient sample</span>
                  ) : (
                    fmtPct(s.winRate)
                  )}
                </td>
                <td className="px-3 py-1.5 tabular-nums">{insufficient ? '—' : s.avgR != null ? fmtSignedR(s.avgR) : '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {emptyLabel && segments.every((s) => s.n === 0) && (
        <div className="px-3 py-2 text-xs text-neutral-600">{emptyLabel}</div>
      )}
    </div>
  );
}
