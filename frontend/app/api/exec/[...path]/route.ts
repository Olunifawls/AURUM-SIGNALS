import { NextRequest } from 'next/server';
import { allowlistedPath, requireSession, RouteAllowlist } from '../../../../lib/proxy-guard';

// Server-side proxy for the admin-guarded L2 Execution API. The ADMIN_API_TOKEN is
// read here (server-only) and injected as X-Admin-Token — it NEVER reaches the
// browser. Client calls /api/exec/<path> -> backend /api/execution/<path>. Only a
// signed-in user reaches the backend, and only on the paths below, which are the
// calls frontend/lib/api.ts makes. No query string or client path is forwarded.

export const dynamic = 'force-dynamic';

const BACKEND = process.env.BACKEND_URL || 'http://localhost:3001';
const BASE = '/api/exec/';

const ROUTES: RouteAllowlist = new Map([
  ['state', ['GET']],
  ['positions', ['GET']],
  ['orders', ['GET']],
  ['equity', ['GET']],
  ['risk-events', ['GET']],
  ['forward-test', ['GET']],
  ['halt', ['POST']],
  ['close', ['POST']],
]);

async function forward(method: 'GET' | 'POST', path: string, body?: string) {
  const token = process.env.ADMIN_API_TOKEN;
  if (!token) {
    return Response.json({ message: 'server is not configured with ADMIN_API_TOKEN' }, { status: 500 });
  }
  try {
    const res = await fetch(`${BACKEND}/api/execution/${path}`, {
      method,
      headers: { 'content-type': 'application/json', 'X-Admin-Token': token },
      body,
      cache: 'no-store',
    });
    const out = await res.text();
    return new Response(out, { status: res.status, headers: { 'content-type': 'application/json' } });
  } catch (err) {
    return Response.json({ message: `upstream unreachable: ${String(err)}` }, { status: 502 });
  }
}

export async function GET(req: NextRequest, { params }: { params: { path: string[] } }) {
  const denied = await requireSession();
  if (denied) return denied;
  const route = allowlistedPath(req, BASE, params.path, ROUTES, 'GET');
  if ('error' in route) return route.error;
  return forward('GET', route.path);
}

export async function POST(req: NextRequest, { params }: { params: { path: string[] } }) {
  const denied = await requireSession();
  if (denied) return denied;
  const route = allowlistedPath(req, BASE, params.path, ROUTES, 'POST');
  if ('error' in route) return route.error;
  const body = await req.text();
  return forward('POST', route.path, body);
}
