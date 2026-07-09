import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * AUTH-1 middleware — validates the Supabase session on every request and
 * redirects unauthenticated visitors to /login. Also passes the current
 * pathname to server components via the x-pathname request header so the
 * root layout can conditionally render Nav (hidden on /login).
 *
 * Uses getUser() (not getSession()) so the JWT is verified server-side and
 * cannot be spoofed by a crafted cookie.
 */
export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Build the initial response; Supabase cookie-setter may replace it.
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          // Write updated session cookies into both the mutated request and the response.
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // IMPORTANT: must call getUser() directly after createServerClient — no logic in between.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isPublic =
    pathname.startsWith('/login') ||
    pathname.startsWith('/api/auth'); // signout route is allowed unauthenticated

  // Not authenticated → redirect to /login (except public routes).
  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  // Already authenticated → redirect away from /login.
  if (user && pathname === '/login') {
    return NextResponse.redirect(new URL('/', request.url));
  }

  // Pass pathname to server layout via a custom request header.
  // This lets the root layout hide Nav/Footer on /login without needing
  // usePathname (which can't be used in Server Components).
  const headersWithPath = new Headers(request.headers);
  headersWithPath.set('x-pathname', pathname);
  const finalResponse = NextResponse.next({ request: { headers: headersWithPath } });
  // Copy any Supabase session cookie updates onto the final response.
  supabaseResponse.cookies.getAll().forEach(({ name, value, ...opts }) => {
    finalResponse.cookies.set(name, value, opts as Parameters<typeof finalResponse.cookies.set>[2]);
  });
  return finalResponse;
}

export const config = {
  matcher: [
    // Run on all paths EXCEPT Next.js internals and static files.
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
