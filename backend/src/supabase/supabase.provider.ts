import { createClient, SupabaseClient } from '@supabase/supabase-js';

export const SUPABASE_CLIENT = 'SUPABASE_CLIENT';

/**
 * Supabase service-role client provider.
 *
 * The client is constructed lazily from environment variables so that the
 * backend can boot (and be unit-tested) without credentials present. It is
 * wired into the DI container but NOT queried anywhere yet — ingestion,
 * indicators and signal logic arrive in later increments.
 */
export const supabaseProvider = {
  provide: SUPABASE_CLIENT,
  useFactory: (): SupabaseClient | null => {
    const url = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!url || !serviceRoleKey) {
      // No credentials yet — return null rather than throwing so the app boots.
      return null;
    }

    return createClient(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  },
};
