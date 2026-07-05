/**
 * L2-INC-1 manual DEMO proof harness (run: `npm run broker:demo`). Exercises the
 * OANDA fxPractice adapter + idempotent place flow against the demo account.
 * NOT run in CI (needs real demo creds). No live URL/token. No signal wiring.
 */
import { loadRepoEnv } from '../load-env';
loadRepoEnv();

import { WebSocket as WsWebSocket } from 'ws';
import { createClient } from '@supabase/supabase-js';
import { OandaAdapter } from './oanda.adapter';
import { OrderPlacementService } from './order-placement.service';

const g = globalThis as { WebSocket?: unknown };
if (typeof g.WebSocket === 'undefined') g.WebSocket = WsWebSocket;

const OANDA = 'https://api-fxpractice.oanda.com';

async function oandaGet(path: string): Promise<any> {
  const r = await fetch(`${OANDA}${path}`, { headers: { Authorization: `Bearer ${process.env.OANDA_API_TOKEN_DEMO}` } });
  return r.json();
}

async function main(): Promise<void> {
  const acctId = process.env.OANDA_ACCOUNT_ID_DEMO!;
  const ccyExpected = process.env.OANDA_ACCOUNT_CCY_DEMO;
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const adapter = new OandaAdapter();

  // (a) getAccount + write base_currency to broker_accounts
  const acct = await adapter.getAccount();
  console.log('(a) getAccount:', { currency: acct.currency, balance: acct.balance, equity: acct.equity, openTrades: acct.openTradeCount, lastTxn: acct.lastTransactionId });
  await sb.from('broker_accounts').upsert(
    { broker: 'OANDA', mode: 'demo', account_ref: acctId, base_currency: acct.currency, is_active: true, updated_at: new Date().toISOString() },
    { onConflict: 'broker,mode,account_ref' },
  );
  const { data: ba } = await sb.from('broker_accounts').select('id,base_currency').eq('broker', 'OANDA').eq('mode', 'demo').eq('account_ref', acctId).single();
  console.log('(a) broker_accounts.base_currency =', ba?.base_currency, '| OANDA_ACCOUNT_CCY_DEMO =', ccyExpected, '| MATCH:', ba?.base_currency === acct.currency && acct.currency === ccyExpected);

  // Confirm XAU_USD unit/price precision empirically
  const instr = (await oandaGet(`/v3/accounts/${acctId}/instruments?instruments=XAU_USD`)).instruments?.[0];
  console.log('XAU_USD precision:', { name: instr?.name, type: instr?.type, minimumTradeSize: instr?.minimumTradeSize, tradeUnitsPrecision: instr?.tradeUnitsPrecision, displayPrecision: instr?.displayPrecision });

  const pr = (await oandaGet(`/v3/accounts/${acctId}/pricing?instruments=XAU_USD`)).prices?.[0];
  const price = Number(pr?.closeoutAsk ?? pr?.asks?.[0]?.price ?? 0);
  console.log('XAU_USD price ~', price, '| tradeable:', pr?.tradeable, '| status:', pr?.status);

  // (b)/(c) place a minimal 1-unit BUY with SL+TP in one request, tied to a synthetic signal
  const p = price || 2000;
  const sl = Number((p * 0.99).toFixed(3));
  const tp = Number((p * 1.02).toFixed(3));
  const { data: sig } = await sb.from('signals').insert({ symbol: 'XAU/USD', timeframe: '4h', direction: 'BUY', entry_price: p, stop_loss: sl, take_profit: tp, rr_ratio: 2, confluence_score: 5, confluence_max: 6, track: 'core', factors: {}, status: 'OPEN', created_at: '2099-11-01T00:00:00Z' }).select('id').single();
  const sigId = (sig as { id: string }).id;
  const tag = `aurum-${sigId}`;
  const sinceBefore = acct.lastTransactionId;

  const svc = new OrderPlacementService(sb as never, adapter);
  const outcome = await svc.placeForSignal({ signalId: sigId, brokerAccountId: ba?.id ?? null, side: 'BUY', units: 1, requestedPrice: p, stopLoss: sl, takeProfit: tp });
  console.log('(b) placeForSignal:', outcome);

  // (c) getTransactionsSince — proven regardless of fill: even a rejected order
  // creates transactions tagged with clientExtensions.id = aurum-{signal_id}.
  const txns = await adapter.getTransactionsSince(sinceBefore);
  console.log('(c) getTransactionsSince tagged with', tag, ':', txns.filter((t) => t.clientTag === tag).map((t) => ({ id: t.id, type: t.type, tag: t.clientTag })));

  if (outcome.status === 'FILLED') {
    const trades = await adapter.getOpenTrades();
    const mine = trades.find((t) => t.clientTag === tag);
    console.log('(b) getOpenTrades:', mine ? { id: mine.id, side: mine.side, units: mine.units, price: mine.price, tag: mine.clientTag } : 'NOT FOUND');
    const tid = mine?.id ?? outcome.brokerTradeId;
    if (tid) {
      const closed = await adapter.closeTrade(tid);
      console.log('(b) closeTrade', tid, '-> closed:', closed.closed);
    }
  } else {
    console.log(`(b) order not filled (status=${outcome.status}, reason=${outcome.reason}).`);
    if (!pr?.tradeable) console.log('    XAU_USD is NOT tradeable right now (market closed) — the place/getOpenTrades/close cycle completes at next market open (re-run this). Not faked.');
  }

  // cleanup: remove the test order rows + synthetic signal (keep the real demo broker_accounts row)
  await sb.from('orders').delete().eq('signal_id', sigId);
  await sb.from('signals').delete().eq('id', sigId);
  console.log('cleanup: test orders + synthetic signal removed.');
}

main().catch((err) => {
  console.error('broker:demo failed:', err);
  process.exit(1);
});
