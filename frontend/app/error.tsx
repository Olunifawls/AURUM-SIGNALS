'use client';

import { useEffect } from 'react';

/**
 * App-shell error boundary. Any uncaught client exception in a page renders this
 * small fallback (keeping the nav/banner/footer intact) and auto-retries, instead
 * of the whole-page "Application error" white-screen.
 */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    const t = setTimeout(() => reset(), 4000);
    return () => clearTimeout(t);
  }, [reset]);

  return (
    <div className="space-y-3 py-10 text-center">
      <p className="text-sm text-neutral-400">Something went wrong loading this view — retrying…</p>
      <button onClick={() => reset()} className="rounded-md border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 hover:bg-neutral-800">
        Retry now
      </button>
    </div>
  );
}
