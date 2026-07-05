'use client';

import { useCallback, useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { apiGet } from '../lib/api';
import { supabase } from '../lib/supabase';
import { useSignalsRealtime } from '../lib/useRealtime';
import { fmtPrice, fmtPct, num, relTime } from '../lib/format';
import { HealthResponse, MarketSnapshot, SignalRow, TIMEFRAMES, Timeframe } from '../lib/types';
import Freshness from '../components/Freshness';
import ActiveSignals from '../components/ActiveSignals';

const CandleChart = dynamic(() => import('../components/CandleChart'), {
  ssr: false,
  loading: () => <div className="h-[360px] w-full animate-pulse rounded-lg bg-neutral-900" />,
});

export default function OverviewPage() {
  const [snapshot, setSnapshot] = useState<MarketSnapshot | null>(null);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [active, setActive] = useState<SignalRow[]>([]);
  const [dayOpen, setDayOpen] = useState<number | null>(null);
  const [tf, setTf] = useState<Timeframe>('1h');

  const load = useCallback(async () => {
    try {
      const [snap, hp, act] = await Promise.all([
        apiGet<MarketSnapshot>('api/market/snapshot'),
        apiGet<HealthResponse>('api/health'),
        apiGet<SignalRow[]>('api/signals/active'),
      ]);
      setSnapshot(snap);
      setHealth(hp);
      setActive(act);
    } catch {
      /* transient — keep last good */
    }
    if (supabase) {
      const { data } = await supabase
        .from('candles')
        .select('open')
        .eq('symbol', 'XAU/USD')
        .eq('timeframe', '1day')
        .order('ts', { ascending: false })
        .limit(1);
      setDayOpen(data?.[0]?.open != null ? Number(data[0].open) : null);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), 30000);
    return () => clearInterval(id);
  }, [load]);
  useSignalsRealtime(load);

  const price = snapshot?.price?.value ?? null;
  const change = price != null && dayOpen != null ? price - dayOpen : null;
  const changePct = change != null && dayOpen ? (change / dayOpen) * 100 : null;

  return (
    <div className="space-y-6">
      <section className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-sm text-neutral-400">XAU/USD</div>
          <div className="flex items-baseline gap-3">
            <span className="text-4xl font-bold tabular-nums">{fmtPrice(price)}</span>
            {change != null && (
              <span className={`text-lg ${change >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {change >= 0 ? '+' : '−'}
                {fmtPrice(Math.abs(change))} ({fmtPct(changePct)})
              </span>
            )}
          </div>
          <div className="mt-1 text-xs text-neutral-500">
            Updated {relTime(snapshot?.dataAsOf)} · FX GBP/USD {fmtPrice(snapshot?.fx?.rate, 4)}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Freshness ts={snapshot?.dataAsOf} />
          {health && (
            <span className="text-xs text-neutral-500">
              market {health.marketOpen ? 'open' : 'closed'}
              {health.stale && <span className="ml-1 text-red-400">· feed stale</span>}
            </span>
          )}
        </div>
      </section>

      <section>
        <div className="mb-2 flex items-center gap-1">
          {TIMEFRAMES.map((t) => (
            <button
              key={t}
              onClick={() => setTf(t)}
              className={`rounded px-3 py-1 text-sm ${
                tf === t ? 'bg-amber-500/15 text-amber-300' : 'text-neutral-400 hover:bg-neutral-800'
              }`}
            >
              {t === '1day' ? '1D' : t === '15min' ? '15m' : t}
            </button>
          ))}
          <span className="ml-auto text-xs text-neutral-500">
            EMA<span className="text-blue-400"> 20</span>
            <span className="text-purple-400"> 50</span>
            <span className="text-amber-400"> 200</span> · S/R dashed
          </span>
        </div>
        <div className="rounded-lg border border-neutral-800 bg-[#0a0a0a] p-1">
          <CandleChart timeframe={tf} indicators={snapshot?.indicators} signals={active} />
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-400">
          Active signals
        </h2>
        <ActiveSignals signals={active} price={price} />
      </section>
    </div>
  );
}
