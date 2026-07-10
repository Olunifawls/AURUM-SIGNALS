/**
 * L2-INC-4 manual DEMO harness (run: `npm run cmd:demo`). Sends a real /status
 * reply to the owner's Telegram — proving the command->reply path live. The
 * INBOUND round-trip (you typing /status on your phone) is verified by the
 * long-poll loop when the backend runs. DEMO ONLY. Not run in CI.
 */
import { loadRepoEnv } from '../load-env';
loadRepoEnv();

import { WebSocket as WsWebSocket } from 'ws';
import { createClient } from '@supabase/supabase-js';
import { OandaAdapter } from '../broker/oanda.adapter';
import { AlertsService } from '../alerts/alerts.service';
import { WeeklyReportService } from '../alerts/weekly-report.service';
import { TradingStateService } from '../risk/trading-state.service';
import { TelegramCommandService } from './telegram-command.service';

const g = globalThis as { WebSocket?: unknown };
if (typeof g.WebSocket === 'undefined') g.WebSocket = WsWebSocket;

async function main(): Promise<void> {
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const adapter = new OandaAdapter();
  const alerts = new AlertsService(sb as never, adapter as never);
  const weeklyReport = new WeeklyReportService(sb as never, adapter, alerts);
  const state = new TradingStateService(sb as never);
  const cmd = new TelegramCommandService(sb as never, adapter, state, alerts, weeklyReport);

  const arg = process.argv[2] ?? '/status';
  console.log(`sending owner command "${arg}" -> Telegram reply ...`);
  // handleCommand runs the command as if it came from the owner (post-auth).
  await (cmd as unknown as { handleCommand(t: string): Promise<void> }).handleCommand(arg);
  console.log('done — check your Telegram.');
}

main().catch((err) => {
  console.error('cmd:demo failed:', err);
  process.exit(1);
});
