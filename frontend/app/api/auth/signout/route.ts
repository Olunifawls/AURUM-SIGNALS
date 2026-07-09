import { createClient } from '../../../../utils/supabase/server';
import { NextResponse } from 'next/server';

/**
 * POST /api/auth/signout — clears the Supabase session server-side (cookie cleared)
 * and redirects to /login. The middleware allowlist includes /api/auth so this
 * route is reachable even when not authenticated (e.g. expired session).
 */
export async function POST(request: Request) {
  const supabase = createClient();
  await supabase.auth.signOut();
  const origin = new URL(request.url).origin;
  return NextResponse.redirect(`${origin}/login`, { status: 302 });
}
