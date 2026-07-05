// Client-side API helper. The browser talks ONLY to same-origin Next.js routes:
//   - GET  /api/proxy/<path>       -> forwards to the backend read API (public)
//   - POST /api/settings/risk-pct  -> server injects X-Admin-Token (never in browser)
//   - GET/POST /api/exec/<path>    -> server injects X-Admin-Token for the L2 API

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`/api/proxy/${path}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`GET ${path} failed (${res.status})`);
  return res.json() as Promise<T>;
}

/** GET an admin-guarded L2 execution endpoint via the token-injecting proxy. */
export async function execGet<T>(path: string): Promise<T> {
  const res = await fetch(`/api/exec/${path}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`GET ${path} failed (${res.status})`);
  return res.json() as Promise<T>;
}

/** POST /api/exec/halt — sets a manual halt (token injected server-side). */
export async function execHalt(): Promise<{ ok: true }> {
  const res = await fetch('/api/exec/halt', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.message || `halt failed (${res.status})`);
  return data;
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

export async function updateAccount(
  account_size: number,
  account_ccy: string,
): Promise<{ ok: true; account_size: number; account_ccy: string }> {
  const res = await fetch('/api/settings/account', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ account_size, account_ccy }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.message || `update failed (${res.status})`);
  return data;
}
