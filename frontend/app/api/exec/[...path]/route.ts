import { NextRequest } from 'next/server';

// Server-side proxy for the admin-guarded L2 Execution API. The ADMIN_API_TOKEN is
// read here (server-only) and injected as X-Admin-Token — it NEVER reaches the
// browser. Client calls /api/exec/<path> -> backend /api/execution/<path>.

export const dynamic = 'force-dynamic';

const BACKEND = process.env.BACKEND_URL || 'http://localhost:3001';

async function forward(method: 'GET' | 'POST', path: string, search: string, body?: string) {
  const token = process.env.ADMIN_API_TOKEN;
  if (!token) {
    return Response.json({ message: 'server is not configured with ADMIN_API_TOKEN' }, { status: 500 });
  }
  try {
    const res = await fetch(`${BACKEND}/api/execution/${path}${search}`, {
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
  return forward('GET', params.path.join('/'), new URL(req.url).search);
}

export async function POST(req: NextRequest, { params }: { params: { path: string[] } }) {
  const body = await req.text();
  return forward('POST', params.path.join('/'), '', body);
}
