export default function CumulativeRChart({ points }: { points: Array<{ day: string; value: number }> }) {
  if (points.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center rounded border border-dashed border-neutral-800 text-sm text-neutral-500">
        No resolved trades yet — the honesty curve will plot here.
      </div>
    );
  }
  const w = 600;
  const h = 160;
  const pad = 10;
  const vals = points.map((p) => p.value);
  const min = Math.min(0, ...vals);
  const max = Math.max(0, ...vals);
  const range = max - min || 1;
  const x = (i: number) => (points.length > 1 ? pad + (i * (w - 2 * pad)) / (points.length - 1) : w / 2);
  const y = (v: number) => pad + ((max - v) / range) * (h - 2 * pad);
  const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const last = points[points.length - 1].value;
  const color = last >= 0 ? '#22c55e' : '#ef4444';
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" preserveAspectRatio="none" role="img" aria-label="Cumulative R curve">
      <line x1={pad} x2={w - pad} y1={y(0)} y2={y(0)} stroke="#404040" strokeDasharray="4 4" strokeWidth={1} />
      <path d={d} fill="none" stroke={color} strokeWidth={2} />
    </svg>
  );
}
