export function num(v: string | number | null | undefined): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function fmtPrice(v: string | number | null | undefined, dp = 2): string {
  const n = num(v);
  if (n == null) return '—';
  return n.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

export function fmtSignedR(v: string | number | null | undefined): string {
  const n = num(v);
  if (n == null) return '—';
  return `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(1)}R`;
}

export function fmtPct(v: number | null | undefined, dp = 1): string {
  if (v == null) return '—';
  return `${v.toFixed(dp)}%`;
}

export function ageMinutes(ts: string | null | undefined): number | null {
  if (!ts) return null;
  const t = Date.parse(ts);
  if (Number.isNaN(t)) return null;
  return (Date.now() - t) / 60000;
}

export function relTime(ts: string | null | undefined): string {
  const m = ageMinutes(ts);
  if (m == null) return '—';
  if (m <= 1) return 'just now'; // recent or feed-ahead-of-local-clock
  const abs = Math.abs(m);
  if (abs < 1) return 'just now';
  if (abs < 60) return `${Math.round(abs)} min ago`;
  const h = abs / 60;
  if (h < 24) return `${Math.round(h)} h ago`;
  return `${Math.round(h / 24)} d ago`;
}
