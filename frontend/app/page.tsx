'use client';

import { useCallback, useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { apiGet } from '../lib/api';
import { supabase } from '../lib/supabase';
import { useSignalsRealtime } from '../lib/useRealtime';
import { fmtPrice, fmtPct, relTime } from '../lib/format';
import { HealthResponse, MarketSnapshot, SignalRow } from '../lib/types';
import Freshness from '../components/Freshness';
import ActiveSignals from '../components/ActiveSignals';

const TradingViewChart = dynamic(() => import('../components/TradingViewChart'), {
  ssr: false,
  loading: () => <div className="h-full w-full animate-pulse rounded-lg bg-neutral-900" />,
});

export default function OverviewPage() {
  const [snapshot, setSnapshot] = useState<MarketSnapshot | null>(null);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [active, setActive] = useState<SignalRow[]>([]);
  const [dayOpen, setDayOpen] = useState<number | null>(null);

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

      {/* Full-size, responsive chart: near full-screen on mobile (edge-to-edge),
          a large ~78vh chart on desktop. */}
      <section className="-mx-4 sm:mx-0">
        <div className="h-[calc(100dvh-200px)] min-h-[440px] w-full sm:h-[min(78vh,820px)] sm:min-h-[520px] sm:rounded-lg sm:border sm:border-neutral-800 sm:bg-neutral-950 sm:p-1">
          <TradingViewChart symbol="OANDA:XAUUSD" />
        </div>
        <p className="mt-1 px-4 text-xs text-neutral-500 sm:px-0">
          Live chart via TradingView — EMA 20/50/200 + RSI, MACD, ATR preloaded; use its controls for
          timeframe, indicators, drawing and fullscreen. Signal levels are listed below and on the
          History page.
        </p>
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
