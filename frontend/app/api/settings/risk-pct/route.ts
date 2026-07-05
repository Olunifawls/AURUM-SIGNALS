import { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

const BACKEND = process.env.BACKEND_URL || 'http://localhost:3001';

/**
 * Server-side write proxy. Holds ADMIN_API_TOKEN as a SERVER-ONLY env var (NOT
 * NEXT_PUBLIC_) and injects the X-Admin-Token header. The browser calls this
 * same-origin route; the admin token never ships to the client.
 */
export async function POST(req: NextRequest) {
  const token = process.env.ADMIN_API_TOKEN;
  if (!token) {
    return Response.json({ message: 'server is not configured with ADMIN_API_TOKEN' }, { status: 500 });
  }
  const body = await req.text();
  try {
    const res = await fetch(`${BACKEND}/api/settings/risk-pct`, {
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
