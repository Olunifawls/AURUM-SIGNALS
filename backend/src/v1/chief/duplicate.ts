/** One stored L1 signal, as far as identifying its setup goes. */
export interface SetupRow {
  id: string;
  symbol: string;
  timeframe: string;
  direction: string;
  entry_price: number | string;
  stop_loss: number | string;
  take_profit: number | string;
  created_at: string;
}

/** Prices compare at 4 decimals, the precision signals stores. */
export const fourDp = (price: number | string): string => Number(price).toFixed(4);

/** Two signals with the same key are the same setup. */
export function setupKey(s: SetupRow): string {
  return [s.symbol, s.timeframe, s.direction, fourDp(s.entry_price), fourDp(s.stop_loss), fourDp(s.take_profit)].join('|');
}

function isEarlier(a: SetupRow, b: SetupRow): boolean {
  const at = Date.parse(a.created_at);
  const bt = Date.parse(b.created_at);
  return at !== bt ? at < bt : a.id < b.id;
}

/** The id of the earliest signal of this setup, or null if this signal is the earliest. */
export function findOriginal(signal: SetupRow, candidates: SetupRow[]): string | null {
  const key = setupKey(signal);
  let original: SetupRow | null = null;
  for (const c of candidates) {
    if (setupKey(c) !== key || !isEarlier(c, signal)) continue;
    if (!original || isEarlier(c, original)) original = c;
  }
  return original?.id ?? null;
}
