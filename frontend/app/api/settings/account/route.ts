import { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

const BACKEND = process.env.BACKEND_URL || 'http://localhost:3001';

/**
 * Server-side write proxy for account settings. Injects X-Admin-Token from a
 * SERVER-ONLY env var — the admin token never ships to the client. Same pattern
 * as the risk-pct write.
 */
export async function POST(req: NextRequest) {
  const token = process.env.ADMIN_API_TOKEN;
  if (!token) {
    return Response.json({ message: 'server is not configured with ADMIN_API_TOKEN' }, { status: 500 });
  }
  const body = await req.text();
  try {
    const res = await fetch(`${BACKEND}/api/settings/account`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-Admin-Token': token },
      body,
    });
    const out = await res.text();
    return new Response(out, { status: res.status, headers: { 'content-type': 'application/json' } });
  } catch (err) {
    return Response.json({ message: `upstream unreachable: ${String(err)}` }, { status: 502 });
  }
}
