'use client';

import { useEffect, useState } from 'react';
import { execGet } from '../lib/api';
import { ExecState, TradingMode } from '../lib/types';

/**
 * Prominent mode banner shown on EVERY page. Data-driven from the backend
 * (TRADING_MODE / broker_accounts.mode via /api/exec/state): grey "DEMO MODE",
 * red "LIVE — REAL MONEY". Defaults to demo if the backend is unreachable.
 */
export default function ModeBanner() {
  const [mode, setMode] = useState<TradingMode>('demo');

  useEffect(() => {
    let alive = true;
    const load = () =>
      execGet<ExecState>('state')
        .then((s) => alive && s?.mode && setMode(s.mode))
        .catch(() => {
          /* keep demo default */
        });
    void load();
    const id = setInterval(() => void load(), 30000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const live = mode === 'live';
  return (
    <div
      className={`w-full px-4 py-1.5 text-center text-xs font-semibold tracking-wide ${
        live ? 'bg-red-600 text-white' : 'bg-neutral-700 text-neutral-200'
      }`}
      role="status"
      aria-label={live ? 'Live mode — real money' : 'Demo mode'}
    >
      {live ? '● LIVE — REAL MONEY' : '● DEMO MODE'}
    </div>
  );
}
