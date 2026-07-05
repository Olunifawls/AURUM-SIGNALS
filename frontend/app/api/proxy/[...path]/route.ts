import { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

const BACKEND = process.env.BACKEND_URL || 'http://localhost:3001';

/**
 * Same-origin proxy for the PUBLIC backend read API. The browser calls
 * /api/proxy/<path>; the Next server forwards it to the backend. This avoids
 * CORS without touching the backend, and keeps all traffic same-origin.
 * No admin token is attached (these endpoints are public reads).
 */
export async function GET(req: NextRequest, { params }: { params: { path: string[] } }) {
  const path = params.path.join('/');
  const search = new URL(req.url).search;
  try {
    const res = await fetch(`${BACKEND}/${path}${search}`, { cache: 'no-store' });
    const body = await res.text();
    return new Response(body, {
      status: res.status,
      headers: { 'content-type': 'application/json' },
    });
  } catch (err) {
    return Response.json({ error: `upstream unreachable: ${String(err)}` }, { status: 502 });
  }
}
