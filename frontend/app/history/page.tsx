'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiGet } from '../../lib/api';
import { useSignalsRealtime } from '../../lib/useRealtime';
import { fmtPrice, fmtSignedR, num } from '../../lib/format';
import { SignalRow, SignalStatus, Timeframe, TIMEFRAMES } from '../../lib/types';

const STATUS_STYLE: Record<string, string> = {
  HIT_TP: 'bg-green-500/15 text-green-300',
  HIT_SL: 'bg-red-500/15 text-red-300',
  EXPIRED: 'bg-neutral-700/40 text-neutral-400',
  OPEN: 'bg-amber-500/15 text-amber-300',
  INVALIDATED: 'bg-neutral-700/40 text-neutral-400',
};

function rMultiple(s: SignalRow): number | null {
  const entry = num(s.entry_price);
  const stop = num(s.stop_loss);
  const pips = num(s.pips_result);
  if (entry == null || stop == null || pips == null || entry === stop) return null;
  return pips / Math.abs(entry - stop);
}

export default function HistoryPage() {
  const [rows, setRows] = useState<SignalRow[]>([]);
  const [status, setStatus] = useState<string>('');
  const [tf, setTf] = useState<string>('');
  const [dir, setDir] = useState<string>('');

  const load = useCallback(async () => {
    try {
      setRows(await apiGet<SignalRow[]>('api/signals?limit=200'));
    } catch {
      /* keep last */
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  useSignalsRealtime(load);

  const filtered = useMemo(
    () =>
      rows.filter(
        (r) =>
          (!status || r.status === status) &&
          (!tf || r.timeframe === tf) &&
          (!dir || r.direction === dir),
      ),
    [rows, status, tf, dir],
  );

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Signal history</h1>

      <div className="flex flex-wrap gap-2 text-sm">
        <Select label="Status" value={status} onChange={setStatus} options={['OPEN', 'HIT_TP', 'HIT_SL', 'EXPIRED', 'INVALIDATED']} />
        <Select label="Timeframe" value={tf} onChange={setTf} options={TIMEFRAMES} />
        <Select label="Direction" value={dir} onChange={setDir} options={['BUY', 'SELL']} />
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-neutral-800 p-10 text-center text-sm text-neutral-500">
          No signals to show{rows.length > 0 ? ' for this filter' : ' yet'}. Every signal this system
          generates will be logged here.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-neutral-800">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="bg-neutral-900 text-xs uppercase text-neutral-500">
              <tr>
                {['Date', 'TF', 'Dir', 'Entry', 'SL', 'TP', 'Score', 'Outcome', 'R'].map((h) => (
                  <th key={h} className="px-3 py-2 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-800">
              {filtered.map((s) => {
                const r = rMultiple(s);
                return (
                  <tr key={s.id} className="hover:bg-neutral-900/50">
                    <td className="whitespace-nowrap px-3 py-2 text-neutral-400">
                      {new Date(s.created_at).toISOString().slice(0, 16).replace('T', ' ')}
                    </td>
                    <td className="px-3 py-2">{s.timeframe}</td>
                    <td className={`px-3 py-2 font-medium ${s.direction === 'BUY' ? 'text-green-400' : 'text-red-400'}`}>
                      {s.direction}
                    </td>
                    <td className="px-3 py-2 tabular-nums">{fmtPrice(s.entry_price)}</td>
                    <td className="px-3 py-2 tabular-nums text-neutral-400">{fmtPrice(s.stop_loss)}</td>
                    <td className="px-3 py-2 tabular-nums text-neutral-400">{fmtPrice(s.take_profit)}</td>
                    <td className="px-3 py-2">
                      {s.confluence_score}/{s.confluence_max}
                    </td>
                    <td className="px-3 py-2">
                      <span className={`rounded px-1.5 py-0.5 text-xs ${STATUS_STYLE[s.status] ?? ''}`}>
                        {s.status}
                      </span>
                    </td>
                    <td className={`px-3 py-2 tabular-nums ${r == null ? 'text-neutral-600' : r >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {r == null ? '—' : fmtSignedR(r)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: readonly string[];
}) {
  return (
    <label className="flex items-center gap-1.5 text-neutral-400">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-neutral-100"
      >
        <option value="">All</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}
