'use client';

import { useCallback, useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { execGet, execHalt } from '../../lib/api';
import { fmtPrice, fmtSignedR, num, relTime } from '../../lib/format';
import { ExecEquity, ExecOrder, ExecPosition, ExecRiskEvent, ExecState } from '../../lib/types';

const EquityCurveChart = dynamic(() => import('../../components/EquityCurveChart'), {
  ssr: false,
  loading: () => <div className="h-[280px] animate-pulse rounded-lg bg-neutral-900" />,
});

function money(v: number | null | undefined, ccy = '') {
  if (v == null) return '—';
  const s = Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 });
  return ccy ? `${s} ${ccy}` : s;
}
function signed(v: number | null | undefined, ccy = '') {
  if (v == null) return '—';
  const sign = v > 0 ? '+' : '';
  return `${sign}${money(v, ccy)}`;
}
function pnlColor(v: number | null | undefined) {
  if (v == null) return 'text-neutral-400';
  return v > 0 ? 'text-emerald-400' : v < 0 ? 'text-red-400' : 'text-neutral-300';
}

function LossBudgetBar({ label, used, max }: { label: string; used: number; max: number }) {
  const pct = max > 0 ? Math.min(100, (used / max) * 100) : 0;
  const danger = pct >= 100;
  const warn = pct >= 66;
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs text-neutral-400">
        <span>{label} loss budget</span>
        <span>
          {used.toFixed(2)}% / {max}% used
        </span>
      </div>
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-neutral-800">
        <div
          className={`h-full rounded-full transition-all ${danger ? 'bg-red-500' : warn ? 'bg-amber-500' : 'bg-emerald-500'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function Card({ label, value, className = '' }: { label: string; value: React.ReactNode; className?: string }) {
  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-3">
      <div className="text-[11px] uppercase tracking-wide text-neutral-500">{label}</div>
      <div className={`mt-1 text-lg font-semibold ${className}`}>{value}</div>
    </div>
  );
}

export default function ExecutionPage() {
  const [state, setState] = useState<ExecState | null>(null);
  const [positions, setPositions] = useState<ExecPosition[]>([]);
  const [orders, setOrders] = useState<ExecOrder[]>([]);
  const [equity, setEquity] = useState<ExecEquity | null>(null);
  const [events, setEvents] = useState<ExecRiskEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [halting, setHalting] = useState(false);

  const load = useCallback(async () => {
    try {
      const [s, p, o, e, r] = await Promise.all([
        execGet<ExecState>('state'),
        execGet<ExecPosition[]>('positions'),
        execGet<ExecOrder[]>('orders'),
        execGet<ExecEquity>('equity'),
        execGet<ExecRiskEvent[]>('risk-events'),
      ]);
      setState(s);
      setPositions(p);
      setOrders(o);
      setEquity(e);
      setEvents(r);
      setError(null);
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    }
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), 30000);
    return () => clearInterval(id);
  }, [load]);

  async function doHalt() {
    setHalting(true);
    try {
      await execHalt();
      setConfirming(false);
      await load();
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setHalting(false);
    }
  }

  const ccy = state?.ccy ?? '';
  const halts = state?.halts ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold">Execution</h1>
          <p className="text-xs text-neutral-500">
            Executed-fills ledger (demo broker). Separate from the{' '}
            <a href="/performance" className="text-amber-400 hover:underline">
              Performance
            </a>{' '}
            page, which is the signal ledger.
          </p>
        </div>
        <button
          onClick={() => setConfirming(true)}
          className="self-start rounded-md border border-red-700 bg-red-900/30 px-3 py-1.5 text-sm font-semibold text-red-300 hover:bg-red-900/60"
        >
          ■ Halt trading
        </button>
      </div>

      {error && (
        <div className="rounded-md border border-red-800 bg-red-950/40 px-3 py-2 text-sm text-red-300">{error}</div>
      )}

      {halts.length > 0 && (
        <div className="rounded-md border border-amber-700 bg-amber-950/30 px-3 py-2 text-sm text-amber-200">
          <span className="font-semibold">Active halts:</span>{' '}
          {halts.map((h) => `${h.halt_type}${h.requires_manual ? ' (manual)' : ''}`).join(', ')}
          <span className="text-amber-400/70"> — no new orders. Open positions keep their broker SL/TP.</span>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Card label="Mode" value={(state?.mode ?? 'demo').toUpperCase()} className="text-amber-300" />
        <Card label="Equity" value={money(state?.equity ?? null, ccy)} />
        <Card label="Open" value={state?.openPositions ?? 0} />
        <Card label="Today P/L" value={signed(state?.todayPnl ?? null, ccy)} className={pnlColor(state?.todayPnl)} />
        <Card label="Week P/L" value={signed(state?.weeklyPnl ?? null, ccy)} className={pnlColor(state?.weeklyPnl)} />
        <Card
          label="Auto-trade"
          value={state?.autoTradeEnabled ? 'ON' : 'OFF'}
          className={state?.autoTradeEnabled ? 'text-emerald-400' : 'text-neutral-400'}
        />
      </div>

      {state && (
        <div className="grid gap-4 rounded-lg border border-neutral-800 bg-neutral-900/40 p-4 sm:grid-cols-2">
          <LossBudgetBar label="Daily" used={state.dailyLossBudget.usedPct} max={state.dailyLossBudget.maxPct} />
          <LossBudgetBar label="Weekly" used={state.weeklyLossBudget.usedPct} max={state.weeklyLossBudget.maxPct} />
          <p className="text-[11px] text-neutral-500 sm:col-span-2">
            Risk/trade {state.tier.riskPerTradePct}% (Tier {state.tier.currentTier}) · resolved demo trades{' '}
            {state.tier.resolvedDemoTrades} · Tier 2 {state.tier.tier2Unlocked ? 'unlocked' : 'locked'}
          </p>
        </div>
      )}

      <section>
        <h2 className="mb-2 text-sm font-semibold text-neutral-300">Equity curve</h2>
        {equity && equity.snapshots.length > 0 ? (
          <div className="rounded-lg border border-neutral-800 bg-neutral-950 p-2">
            <EquityCurveChart points={equity.snapshots} hwm={equity.hwm} />
          </div>
        ) : (
          <EmptyState text="No equity snapshots yet." />
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-neutral-300">Open positions</h2>
        {positions.length === 0 ? (
          <EmptyState text="No open positions — that's normal." />
        ) : (
          <Table
            head={['Opened', 'TF', 'Side', 'Units', 'Entry', 'SL', 'TP', 'Slip', 'Live P/L']}
            rows={positions.map((p) => [
              relTime(p.opened_at),
              p.timeframe ?? '—',
              <span key="s" className={p.side === 'BUY' ? 'text-emerald-400' : 'text-red-400'}>{p.side}</span>,
              fmtPrice(p.units, 1),
              fmtPrice(p.entry_price),
              fmtPrice(p.stop_loss),
              fmtPrice(p.take_profit),
              p.slippage_points != null ? fmtPrice(p.slippage_points, 3) : '—',
              <span key="pl" className={pnlColor(num(p.live_pl))}>{signed(num(p.live_pl), ccy)}</span>,
            ])}
          />
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-neutral-300">Order history (fills)</h2>
        {orders.length === 0 ? (
          <EmptyState text="No orders yet." />
        ) : (
          <Table
            head={['When', 'Side', 'Units', 'Req.', 'Fill', 'Slip', 'R', 'Status']}
            rows={orders.map((o) => [
              relTime(o.created_at),
              <span key="s" className={o.side === 'BUY' ? 'text-emerald-400' : 'text-red-400'}>{o.side}</span>,
              fmtPrice(o.units, 1),
              o.requested_price != null ? fmtPrice(o.requested_price) : '—',
              o.filled_price != null ? fmtPrice(o.filled_price) : '—',
              o.slippage_points != null ? fmtPrice(o.slippage_points, 3) : '—',
              o.realized_r != null ? fmtSignedR(o.realized_r) : o.achieved_rr != null ? fmtPrice(o.achieved_rr, 2) : '—',
              <StatusPill key="st" status={o.status} />,
            ])}
          />
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-neutral-300">Risk-event log</h2>
        {events.length === 0 ? (
          <EmptyState text="No risk events logged." />
        ) : (
          <div className="divide-y divide-neutral-800 rounded-lg border border-neutral-800">
            {events.map((e, i) => (
              <div key={i} className="flex items-start gap-3 px-3 py-2 text-sm">
                <span className="w-24 shrink-0 text-xs text-neutral-500">{relTime(e.created_at)}</span>
                <span
                  className={`w-40 shrink-0 font-mono text-xs ${
                    e.severity === 'CRITICAL' ? 'text-red-400' : e.severity === 'WARN' ? 'text-amber-400' : 'text-neutral-400'
                  }`}
                >
                  {e.event_type}
                </span>
                <span className="text-neutral-300">{e.message}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      {confirming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-sm rounded-lg border border-neutral-700 bg-neutral-900 p-5">
            <h3 className="text-base font-semibold">Halt trading?</h3>
            <p className="mt-2 text-sm text-neutral-400">
              This sets a manual halt — no new orders will be placed. Open positions keep their broker SL/TP. Clear it
              later with /resume on Telegram.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setConfirming(false)} className="rounded-md px-3 py-1.5 text-sm text-neutral-300 hover:bg-neutral-800">
                Cancel
              </button>
              <button
                onClick={() => void doHalt()}
                disabled={halting}
                className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-50"
              >
                {halting ? 'Halting…' : 'Confirm halt'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div className="rounded-lg border border-dashed border-neutral-800 px-4 py-8 text-center text-sm text-neutral-500">{text}</div>;
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    FILLED: 'bg-emerald-900/40 text-emerald-300',
    REJECTED: 'bg-red-900/40 text-red-300',
    ERROR: 'bg-red-900/40 text-red-300',
    PENDING: 'bg-neutral-800 text-neutral-300',
    DUPLICATE: 'bg-amber-900/40 text-amber-300',
  };
  return <span className={`rounded px-2 py-0.5 text-xs ${map[status] ?? 'bg-neutral-800 text-neutral-300'}`}>{status}</span>;
}

function Table({ head, rows }: { head: string[]; rows: React.ReactNode[][] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-neutral-800">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-neutral-800 text-left text-xs uppercase text-neutral-500">
            {head.map((h) => (
              <th key={h} className="px-3 py-2 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-neutral-900 last:border-0">
              {r.map((c, j) => (
                <td key={j} className="px-3 py-2 tabular-nums text-neutral-200">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
