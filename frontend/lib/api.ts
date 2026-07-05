// Client-side API helper. The browser talks ONLY to same-origin Next.js routes:
//   - GET  /api/proxy/<path>       -> forwards to the backend read API (public)
//   - POST /api/settings/risk-pct  -> server injects X-Admin-Token (never in browser)

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`/api/proxy/${path}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`GET ${path} failed (${res.status})`);
  return res.json() as Promise<T>;
}

export async function updateRiskPct(
  risk_pct: number,
  acknowledgment?: string,
): Promise<{ ok: true; tier: number; risk_pct: number }> {
  const res = await fetch('/api/settings/risk-pct', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ risk_pct, acknowledgment }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.message || `update failed (${res.status})`);
  return data;
}
