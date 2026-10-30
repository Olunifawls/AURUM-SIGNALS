'use client';

import { useCallback, useEffect, useState } from 'react';
import { execGet } from '../../lib/api';
import { fmtSignedR, relTime } from '../../lib/format';
import { ForwardTestGroup, ForwardTestReport, ForwardTestWatch } from '../../lib/types';
import CumulativeRChart from '../../components/CumulativeRChart';

const MIN_SAMPLE = 30; // same rule as Performance: smaller groups are greyed

const AGENT_LABEL: Record<string, string> = {
  technical: 'Technical',
  regime: 'Regime',
  dollar: 'Dollar',
  yields10y: 'Yields 10Y',
  yields2y: 'Yields 2Y',
  sentiment: 'COT',
  news: 'News',
};

const COPY =
  'Every L1 signal, judged by ruleset v1 and tracked to its L1 outcome, including the ones v1 vetoed. Only HARD rules block or close a trade. Everything else is logged here to be proved or dropped on forward data.';

function rColor(v: number | null | undefined) {
  if (v == null || v === 0) return 'text-neutral-300';
  return v > 0 ? 'text-green-400' : 'text-red-400';
}

function verdictColor(v: string) {
  if (v === 'PASS' || v === 'SUPPORT') return 'text-green-400';
  if (v === 'FAIL' || v === 'OPPOSE') return 'text-red-400';
  if (v === 'DATA_MISSING') return 'text-amber-400';
  return 'text-neutral-400';
}

export default function ForwardTestPage() {
  const [report, setReport] = useState<ForwardTestReport | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      setReport(await execGet<ForwardTestReport>('forward-test'));
      setFailed(false);
    } catch {
      setFailed(true); // keep the last good report on screen
    }
  }, []);
  useEffect(() => {
    void load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Forward Test — ruleset {report?.ruleset ?? 'v1'}</h1>
        <p className="mt-2 max-w-3xl text-sm text-neutral-400">{COPY}</p>
        <p className="mt-1 text-xs text-neutral-500">Signal R is measured on feed prices, before broker spread and slippage.</p>
      </div>

      {failed && <p className="text-sm text-amber-400">Couldn&apos;t load the forward test. Retrying every minute.</p>}

      {report && (
        <>
          <section className="grid gap-4 md:grid-cols-2">
            <CurvePanel title="Kept by v1" group={report.kept} />
            <CurvePanel title="Vetoed by v1" group={report.vetoed} />
          </section>

          <section>
            <Heading>R by agent verdict</Heading>
            <div className="overflow-x-auto rounded-lg border border-neutral-800">
              <table className="w-full text-left text-sm">
                <thead className="text-xs uppercase text-neutral-500">
                  <tr>
                    {['Agent', 'Verdict', 'Signals', 'Resolved', 'W / L', 'R'].map((h) => (
                      <th key={h} className="px-3 py-1.5 font-medium">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {report.byVerdict.map((v) => (
                    <tr key={`${v.agent}-${v.verdict}`} className={v.resolved < MIN_SAMPLE ? 'text-neutral-600' : ''}>
                      <td className="px-3 py-1.5">{AGENT_LABEL[v.agent] ?? v.agent}</td>
                      <td className={`px-3 py-1.5 ${v.resolved < MIN_SAMPLE ? '' : verdictColor(v.verdict)}`}>{v.verdict}</td>
                      <td className="px-3 py-1.5 tabular-nums">{v.signals}</td>
                      <td className="px-3 py-1.5 tabular-nums">{v.resolved}</td>
                      <td className="px-3 py-1.5 tabular-nums">
                        {v.wins} / {v.losses}
                      </td>
                      <td className="px-3 py-1.5 tabular-nums">{fmtSignedR(v.totalR)}</td>
                    </tr>
                  ))}
                  {report.byVerdict.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-3 py-3 text-xs text-neutral-600">
                        No signals evaluated yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <p className="mt-1 text-xs text-neutral-600">Greyed rows have fewer than {MIN_SAMPLE} resolved signals.</p>
          </section>

          <section>
            <Heading>News exits</Heading>
            <div className="grid gap-3 sm:grid-cols-3">
              <Stat label="Exits settled" value={String(report.newsExits.settled)} />
              <Stat label="R at exit" value={fmtSignedR(report.newsExits.exitR)} className={rColor(report.newsExits.exitR)} />
              <Stat label="R if held" value={fmtSignedR(report.newsExits.holdR)} className={rColor(report.newsExits.holdR)} />
            </div>
            {report.newsExits.trades.length > 0 && (
              <div className="mt-3 overflow-x-auto rounded-lg border border-neutral-800">
                <table className="w-full text-left text-sm">
                  <thead className="text-xs uppercase text-neutral-500">
                    <tr>
                      {['Event', 'Closed', 'R at exit', 'R if held'].map((h) => (
                        <th key={h} className="px-3 py-1.5 font-medium">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {report.newsExits.trades.map((t) => (
                      <tr key={t.positionId}>
                        <td className="px-3 py-1.5">{t.event ?? '—'}</td>
                        <td className="px-3 py-1.5 text-neutral-400">{t.closedAt ? relTime(t.closedAt) : '—'}</td>
                        <td className={`px-3 py-1.5 tabular-nums ${rColor(t.exitR)}`}>{fmtSignedR(t.exitR)}</td>
                        <td className={`px-3 py-1.5 tabular-nums ${rColor(t.holdR)}`}>{t.holdR == null ? 'signal still open' : fmtSignedR(t.holdR)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="grid gap-4 md:grid-cols-2">
            <ShadowPanel title="Thesis watch (shadow)" note="Regime or dollar turned against an open trade. Logged, never acted on." watch={report.thesisWatch} />
            <ShadowPanel title="Dollar shock (shadow)" note="The dollar moved against a trade by more than its average hourly range. Logged, never acted on." watch={report.dollarShock} />
          </section>

          <section>
            <Heading>Latest evaluations</Heading>
            <div className="space-y-2">
              {report.recent.map((r) => (
                <div key={r.signalId} className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className={r.eligible ? 'font-semibold text-green-400' : 'font-semibold text-red-400'}>{r.eligible ? 'ELIGIBLE' : 'VETOED'}</span>
                    <span>{r.timeframe}</span>
                    <span className="text-neutral-500">{relTime(r.createdAt)}</span>
                    <span className="text-neutral-500">{r.status}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                    {r.agents.map((a) => (
                      <span key={a.agent} className="text-neutral-500">
                        {AGENT_LABEL[a.agent] ?? a.agent} <span className={verdictColor(a.verdict)}>{a.verdict}</span>
                      </span>
                    ))}
                  </div>
                  {r.aiSummary && <p className="mt-2 text-xs text-neutral-400">{r.aiSummary}</p>}
                </div>
              ))}
              {report.recent.length === 0 && <p className="text-xs text-neutral-600">No signals evaluated yet.</p>}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function Heading({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-400">{children}</h2>;
}

function Stat({ label, value, className = '' }: { label: string; value: string; className?: string }) {
  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-3">
      <div className="text-xs text-neutral-500">{label}</div>
      <div className={`mt-1 text-xl font-semibold tabular-nums ${className}`}>{value}</div>
    </div>
  );
}

function CurvePanel({ title, group }: { title: string; group: ForwardTestGroup & { curve: Array<{ day: string; value: number }> } }) {
  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-3">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-neutral-300">{title}</h2>
        <span className={`text-lg font-semibold tabular-nums ${rColor(group.totalR)}`}>{fmtSignedR(group.totalR)}</span>
      </div>
      <p className="mb-2 text-xs text-neutral-500">
        {group.signals} signals, {group.resolved} resolved, {group.wins}W / {group.losses}L
      </p>
      <CumulativeRChart points={group.curve} />
    </div>
  );
}

function ShadowPanel({ title, note, watch }: { title: string; note: string; watch: ForwardTestWatch }) {
  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-3">
      <h2 className="text-sm font-semibold text-neutral-300">{title}</h2>
      <p className="mb-2 text-xs text-neutral-500">{note}</p>
      <div className="grid grid-cols-3 gap-2 text-sm">
        <div>
          <div className="text-xs text-neutral-500">Events</div>
          <div className="tabular-nums">{watch.events.length}</div>
        </div>
        <div>
          <div className="text-xs text-neutral-500">R if acted on</div>
          <div className={`tabular-nums ${rColor(watch.actedR)}`}>{fmtSignedR(watch.actedR)}</div>
        </div>
        <div>
          <div className="text-xs text-neutral-500">R as held</div>
          <div className={`tabular-nums ${rColor(watch.heldR)}`}>{fmtSignedR(watch.heldR)}</div>
        </div>
      </div>
      <p className="mt-2 text-xs text-neutral-600">{watch.settled} settled. Open trades count once they close.</p>
    </div>
  );
}
