'use client';

import { useEffect } from 'react';

/**
 * Route error boundary for the Execution page. A transient client exception (e.g.
 * a chart render hiccup) shows this fallback instead of white-screening the whole
 * page, and auto-retries — the next poll re-renders cleanly. Fail safe.
 */
export default function ExecutionError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    const t = setTimeout(() => reset(), 4000); // recover on the next cycle
    return () => clearTimeout(t);
  }, [reset]);

  return (
    <div className="space-y-3 py-10 text-center">
      <p className="text-sm text-neutral-400">Couldn&apos;t load the Execution view — retrying…</p>
      <button onClick={() => reset()} className="rounded-md border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 hover:bg-neutral-800">
        Retry now
      </button>
    </div>
  );
}
