import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

/** Server-side Supabase client for RSC and API routes — reads session from cookies. */
export function createClient() {
  const cookieStore = cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            // Called from a Server Component — middleware handles the refresh, so this is safe to ignore.
          }
        },
      },
    },
  );
}
