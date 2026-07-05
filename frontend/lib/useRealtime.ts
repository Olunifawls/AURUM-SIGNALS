'use client';

import { useEffect } from 'react';
import { supabase } from './supabase';

/**
 * Subscribe to Supabase `signals` inserts/updates/deletes (anon, RLS read-only)
 * and invoke `onChange` so new/resolved signals appear without a refresh.
 */
export function useSignalsRealtime(onChange: () => void) {
  useEffect(() => {
    const client = supabase;
    if (!client) return;
    const channel = client
      .channel('signals-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'signals' }, () => onChange())
      .subscribe();
    return () => {
      void client.removeChannel(channel);
    };
  }, [onChange]);
}
