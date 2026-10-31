import { createClient } from '../utils/supabase/server';

// Server-side guards for every route handler that forwards to the backend. They
// repeat the middleware's session check on purpose: when the matcher had a gap, the
// handlers still attached the admin token. Never import this from client code.

type Method = 'GET' | 'POST';

/** Exact backend paths a proxy may reach, relative to its base, and their methods. */
export type RouteAllowlist = ReadonlyMap<string, readonly Method[]>;

// A % in the raw path means encoding, which no allowlisted path uses, and it is what
// every traversal relies on. Decoded segments are checked too.
const UNSAFE = /[%\\?#/]|\.\./;

/** 401 unless the request has a valid Supabase session, otherwise null. */
export async function requireSession(): Promise<Response | null> {
  const {
    data: { user },
  } = await createClient().auth.getUser();
  return user ? null : Response.json({ message: 'unauthorized' }, { status: 401 });
}

/**
 * Resolves a catch-all path against an allowlist. Returns the allowlisted path, or
 * the error to send: 400 for an unsafe path, 404 if unlisted, 405 for a wrong method.
 * The upstream URL must be built only from the returned path.
 */
export function allowlistedPath(
  req: Request,
  base: string,
  segments: string[],
  routes: RouteAllowlist,
  method: Method,
): { path: string } | { error: Response } {
  const raw = new URL(req.url).pathname;
  const rawTail = raw.startsWith(base) ? raw.slice(base.length).split('/') : [raw];
  if ([...rawTail, ...segments].some((part) => UNSAFE.test(part))) {
    return { error: Response.json({ message: 'invalid path' }, { status: 400 }) };
  }
  const path = segments.join('/');
  const methods = routes.get(path);
  if (!methods) return { error: Response.json({ message: 'not found' }, { status: 404 }) };
  if (!methods.includes(method)) {
    return { error: Response.json({ message: 'method not allowed' }, { status: 405 }) };
  }
  return { path };
}
