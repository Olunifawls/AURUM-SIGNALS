import { SupabaseClient } from '@supabase/supabase-js';
import { positionR, SignalRisk } from '../v1/ledger/forward-test';

/** A failed read must not stop a close being recorded, so it counts as no signal. */
async function signalRisk(db: SupabaseClient, signalId: string | null | undefined): Promise<SignalRisk | null> {
  if (!signalId) return null;
  try {
    const { data, error } = await db.from('signals').select('entry_price,stop_loss').eq('id', signalId).limit(1);
    const signal = data?.[0];
    return error || !signal ? null : { entry: Number(signal.entry_price), stop: Number(signal.stop_loss) };
  } catch {
    return null;
  }
}

/** The R to store when a position closes. */
export async function closedPositionR(db: SupabaseClient, pos: Record<string, any>, closePrice: number): Promise<number | null> {
  const position = { side: pos.side, fill: Number(pos.entry_price), initialStop: Number(pos.initial_stop_loss ?? pos.stop_loss) };
  return positionR(position, await signalRisk(db, pos.signal_id), closePrice);
}
