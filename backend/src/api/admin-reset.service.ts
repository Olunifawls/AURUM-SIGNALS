import { Inject, Injectable, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../supabase/supabase.provider';
import { BROKER_ADAPTER, IBrokerAdapter } from '../broker/broker.interface';

export interface LedgerResetResult {
  flattenedTrades: number;
  openTradesAfter: number;
  wipedCounts: Record<string, number>;
  haltsCleared: number;
  baselineEquity: number;
  baselineCcy: string;
  ts: string;
}

/**
 * FIX-2 one-shot admin operation:
 *   1. Close ALL open OANDA demo trades (flatten).
 *   2. Verify the account is flat.
 *   3. Wipe the contaminated trading ledger atomically via reset_demo_ledger().
 *      Clean-data tables (candles, fx_rates, indicator_snapshots, broker_accounts,
 *      user_settings) are NEVER touched.
 *   4. Re-baseline equity: write fresh DAILY_REF, WEEKLY_REF, and HOURLY
 *      equity_snapshots from the current OANDA equity — so loss/drawdown
 *      breakers start from a clean reference instead of the stale £101k HWM.
 *
 * Called only from AdminResetController (AdminTokenGuard + confirm body).
 * DEMO ONLY. Does not change engine, risk, or execution logic.
 */
@Injectable()
export class AdminResetService {
  private readonly logger = new Logger('AdminReset');

  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient | null,
    @Inject(BROKER_ADAPTER) private readonly broker: IBrokerAdapter,
  ) {}

  async ledgerReset(): Promise<LedgerResetResult> {
    if (!this.supabase) throw new Error('Supabase not configured');
    const ts = new Date().toISOString();

    // Step 1: Close all open trades at OANDA (flatten).
    const openTrades = await this.broker.getOpenTrades();
    let flattenedTrades = 0;
    for (const t of openTrades) {
      this.logger.log(`FIX-2 closing trade ${t.id} (${t.side} ${t.units} ${t.instrument})`);
      try {
        await this.broker.closeTrade(t.id);
        flattenedTrades++;
      } catch (err) {
        throw new Error(
          `Failed to close trade ${t.id}: ${String(err)}. Close manually on OANDA and retry.`,
        );
      }
    }

    // Step 2: Verify the account is flat before touching the DB.
    const remaining = await this.broker.getOpenTrades();
    if (remaining.length > 0) {
      throw new Error(
        `Account not flat after close attempts (${remaining.length} trades remain). Retry once they close.`,
      );
    }

    // Step 3: Atomic ledger wipe + halt clear via stored procedure.
    const { data: rpcData, error: rpcErr } = await this.supabase.rpc('reset_demo_ledger');
    if (rpcErr) throw new Error(`Ledger wipe failed: ${rpcErr.message}`);
    const wipedCounts = (rpcData ?? {}) as Record<string, number>;
    const haltsCleared = wipedCounts['halts_cleared'] ?? 0;
    this.logger.log(`FIX-2 wipe: ${JSON.stringify(wipedCounts)}`);

    // Step 4: Re-baseline equity from the current live OANDA account.
    const account = await this.broker.getAccount();
    const equity = account.equity;

    const { data: ba } = await this.supabase
      .from('broker_accounts')
      .select('id')
      .eq('broker', 'OANDA')
      .eq('mode', 'demo')
      .limit(1);
    const brokerAccountId = ba?.[0]?.id ?? null;

    // Write three snapshots sharing the same moment: DAILY_REF, WEEKLY_REF, HOURLY.
    // All three carry high_water_mark = current equity, so the drawdown/loss
    // breakers start from a clean baseline.
    const snapBase = {
      broker_account_id: brokerAccountId,
      mode: 'demo',
      balance: account.balance,
      equity,
      unrealized_pl: 0,
      open_positions: 0,
      high_water_mark: equity,
      ts,
    };
    const { error: snapErr } = await this.supabase.from('equity_snapshots').insert([
      { ...snapBase, snapshot_type: 'HOURLY' },
      { ...snapBase, snapshot_type: 'DAILY_REF' },
      { ...snapBase, snapshot_type: 'WEEKLY_REF' },
    ]);
    if (snapErr) throw new Error(`Equity baseline write failed: ${snapErr.message}`);

    this.logger.log(
      `FIX-2 complete: flattened=${flattenedTrades} haltsCleared=${haltsCleared} equity=${equity} ${account.currency}`,
    );
    return {
      flattenedTrades,
      openTradesAfter: 0,
      wipedCounts,
      haltsCleared,
      baselineEquity: equity,
      baselineCcy: account.currency,
      ts,
    };
  }
}
