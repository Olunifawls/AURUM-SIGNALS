import { FactorDetail } from '../lib/types';

const FACTORS: Array<{ key: string; label: string }> = [
  { key: 'F1_trend_higher', label: 'Trend HTF' },
  { key: 'F2_trend_local', label: 'Trend' },
  { key: 'F3_rsi', label: 'RSI' },
  { key: 'F4_macd', label: 'MACD' },
  { key: 'F5_structure', label: 'Structure' },
  { key: 'F6_momentum', label: 'Momentum' },
];

export default function FactorChips({ factors }: { factors: Record<string, FactorDetail> | null }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {FACTORS.map((f) => {
        const pass = !!factors?.[f.key]?.pass;
        return (
          <span
            key={f.key}
            className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs ${
              pass ? 'bg-green-500/15 text-green-300' : 'bg-neutral-800 text-neutral-500'
            }`}
          >
            {pass ? '✓' : '✗'} {f.label}
          </span>
        );
      })}
    </div>
  );
}
