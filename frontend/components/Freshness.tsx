import { ageMinutes, relTime } from '../lib/format';

/** Data-freshness indicator: green <10 min, amber <30 min, red stale. */
export default function Freshness({ ts }: { ts: string | null | undefined }) {
  const age = ageMinutes(ts);
  // Negative age (feed timestamp ahead of local clock) counts as fresh.
  const effective = age == null ? Infinity : Math.max(0, age);
  let color = 'bg-red-500';
  let label = 'STALE';
  if (effective < 10) {
    color = 'bg-green-500';
    label = 'LIVE';
  } else if (effective < 30) {
    color = 'bg-amber-500';
    label = 'DELAYED';
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-neutral-700 px-2 py-0.5 text-xs text-neutral-300">
      <span className={`h-2 w-2 rounded-full ${color}`} />
      {label}
      <span className="text-neutral-500">· {relTime(ts)}</span>
    </span>
  );
}
