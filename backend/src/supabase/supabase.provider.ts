import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { WebSocket as WsWebSocket } from 'ws';

// @supabase/supabase-js initialises a realtime client that requires a global
// WebSocket. Node 20 (our locked runtime) has no global WebSocket, so we
// polyfill one from `ws`. The backend only uses the REST/PostgREST API — this
// just satisfies the constructor; realtime is never actually used.
const g = globalThis as { WebSocket?: unknown };
if (typeof g.WebSocket === 'undefined') {
  g.WebSocket = WsWebSocket;
}

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
