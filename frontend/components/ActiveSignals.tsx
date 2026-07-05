import { SignalRow } from '../lib/types';
import { fmtPrice, fmtSignedR, num } from '../lib/format';
import FactorChips from './FactorChips';

function unrealisedR(s: SignalRow, price: number | null): number | null {
  if (price == null) return null;
  const entry = num(s.entry_price);
  const stop = num(s.stop_loss);
  if (entry == null || stop == null || entry === stop) return null;
  const risk = Math.abs(entry - stop);
  const move = s.direction === 'BUY' ? price - entry : entry - price;
  return move / risk;
}

export default function ActiveSignals({
  signals,
  price,
}: {
  signals: SignalRow[];
  price: number | null;
}) {
  if (signals.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-neutral-800 p-8 text-center text-sm text-neutral-500">
        No active signals right now. The engine only fires when multi-factor confluence and trend
        alignment agree — refusing to trade is normal and expected.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {signals.map((s) => {
        const r = unrealisedR(s, price);
        return (
          <div key={s.id} className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span
                  className={`rounded px-2 py-0.5 text-sm font-semibold ${
                    s.direction === 'BUY' ? 'bg-green-500/15 text-green-300' : 'bg-red-500/15 text-red-300'
                  }`}
                >
                  {s.direction}
                </span>
                <span className="text-sm text-neutral-400">{s.timeframe}</span>
                <span className="text-xs text-neutral-500">
                  {s.confluence_score}/{s.confluence_max} confluence
                </span>
              </div>
              <div className="text-right text-sm">
                <span className="text-neutral-500">Unrealised </span>
                <span className={r != null && r >= 0 ? 'text-green-400' : 'text-red-400'}>
                  {r != null ? fmtSignedR(r) : '—'}
                </span>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
              <div>
                <div className="text-xs text-neutral-500">Entry</div>
                <div>{fmtPrice(s.entry_price)}</div>
              </div>
              <div>
                <div className="text-xs text-neutral-500">Stop</div>
                <div className="text-red-300">{fmtPrice(s.stop_loss)}</div>
              </div>
              <div>
                <div className="text-xs text-neutral-500">Target</div>
                <div className="text-green-300">{fmtPrice(s.take_profit)}</div>
              </div>
            </div>
            {s.sizing_note && <div className="mt-2 text-xs text-neutral-400">{s.sizing_note}</div>}
            <div className="mt-3">
              <FactorChips factors={s.factors} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
