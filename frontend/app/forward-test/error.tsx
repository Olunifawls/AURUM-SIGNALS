'use client';

import { useEffect } from 'react';

/** Route error boundary, same recovery as the Execution page. */
export default function ForwardTestError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    const t = setTimeout(() => reset(), 4000);
    return () => clearTimeout(t);
  }, [reset]);

  return (
    <div className="space-y-3 py-10 text-center">
      <p className="text-sm text-neutral-400">Couldn&apos;t load the Forward Test view — retrying…</p>
      <button onClick={() => reset()} className="rounded-md border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 hover:bg-neutral-800">
        Retry now
      </button>
    </div>
  );
}
