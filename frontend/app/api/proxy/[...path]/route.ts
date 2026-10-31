import { NextRequest } from 'next/server';
import { allowlistedPath, requireSession, RouteAllowlist } from '../../../../lib/proxy-guard';

export const dynamic = 'force-dynamic';

const BACKEND = process.env.BACKEND_URL || 'http://localhost:3001';
const BASE = '/api/proxy/';

// The backend reads the dashboard makes through apiGet() in frontend/lib/api.ts.
const ROUTES: RouteAllowlist = new Map([
  ['api/market/snapshot', ['GET']],
  ['api/health', ['GET']],
  ['api/signals', ['GET']],
  ['api/signals/active', ['GET']],
  ['api/performance', ['GET']],
  ['api/sizing/tier-status', ['GET']],
  ['api/settings', ['GET']],
]);

/**
 * Same-origin proxy for the backend read API. The browser calls /api/proxy/<path>;
 * the Next server forwards it to the backend. This avoids CORS without touching the
 * backend, and keeps all traffic same-origin. No admin token is attached. Only a
 * signed-in user reaches the backend, and only on the paths above. The one query
 * forwarded is a numeric limit on api/signals.
 */
export async function GET(req: NextRequest, { params }: { params: { path: string[] } }) {
  const denied = await requireSession();
  if (denied) return denied;
  const route = allowlistedPath(req, BASE, params.path, ROUTES, 'GET');
  if ('error' in route) return route.error;
  const limit = new URL(req.url).searchParams.get('limit');
  const search = route.path === 'api/signals' && limit && /^\d{1,4}$/.test(limit) ? `?limit=${limit}` : '';
  try {
    const res = await fetch(`${BACKEND}/${route.path}${search}`, { cache: 'no-store' });
    const body = await res.text();
    return new Response(body, {
      status: res.status,
      headers: { 'content-type': 'application/json' },
    });
  } catch (err) {
    return Response.json({ error: `upstream unreachable: ${String(err)}` }, { status: 502 });
  }
}
