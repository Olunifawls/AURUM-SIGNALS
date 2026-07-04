import { createClient, SupabaseClient } from '@supabase/supabase-js';

/**
 * Supabase browser client (anon key).
 *
 * Wired from the public env vars but NOT queried anywhere yet — data reads
 * arrive in a later increment. Returns null if env vars are absent so that
 * a build without configured secrets still succeeds.
 */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const supabase: SupabaseClient | null =
  url && anonKey ? createClient(url, anonKey) : null;
