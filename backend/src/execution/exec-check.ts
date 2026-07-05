/**
 * L2-INC-3 manual DEMO harness (run: `npm run exec:demo`). Runs a REAL
 * reconciliation + equity snapshot against the demo account and prints results.
 * Proves (g) equity snapshots and that reconcile reads the broker (no writes to
 * broker). NOT run in CI. DEMO ONLY.
 */
import { loadRepoEnv } from '../load-env';
loadRepoEnv();

import { WebSocket as WsWebSocket } from 'ws';
import { createClient } from '@supabase/supabase-js';
import { OandaAdapter } from '../broker/oanda.adapter';
import { ReconciliationService } from './reconciliation.service';
import { ExecutionReadinessService } from './readiness.service';

const g = globalThis as { WebSocket?: unknown };
if (typeof g.WebSocket === 'undefined') g.WebSocket = WsWebSocket;

async function main(): Promise<void> {
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const adapter = new OandaAdapter();
  const alerts = { sendAdminError: async () => undefined } as any;
  const recon = new ReconciliationService(sb as never, adapter, new ExecutionReadinessService(), alerts);

  const res = await recon.reconcile();
  console.log('reconcile (reads broker, writes only DB):', res);

  await recon.snapshotEquity('DAILY_REF');

  const { data } = await sb
    .from('equity_snapshots')
    .select('ts,equity,balance,high_water_mark,snapshot_type,open_positions,unrealized_pl')
    .order('ts', { ascending: false })
    .limit(3);
  console.log('latest equity_snapshots:', data);

  const { data: ba } = await sb
    .from('broker_accounts')
    .select('base_currency,last_transaction_id,last_reconciled_at')
    .eq('broker', 'OANDA')
    .eq('mode', 'demo')
    .limit(1);
  console.log('broker_accounts cursor:', ba?.[0]);
}

main().catch((err) => {
  console.error('exec:demo failed:', err);
  process.exit(1);
});
