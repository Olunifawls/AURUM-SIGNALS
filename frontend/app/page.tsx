export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-between p-8">
      <div className="flex flex-1 flex-col items-center justify-center text-center">
        <h1 className="text-5xl font-bold tracking-tight text-amber-400">
          AURUM SIGNALS
        </h1>
        <p className="mt-4 text-lg text-neutral-400">
          Level 1 — build in progress
        </p>
      </div>

      <footer className="mt-12 max-w-2xl text-center text-xs text-neutral-500">
        Analysis tool. Not financial advice. Past performance does not guarantee
        future results. Personal use only.
      </footer>
    </main>
  );
}
