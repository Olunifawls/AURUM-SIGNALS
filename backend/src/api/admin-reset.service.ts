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

// Impossible UUID — matches no real row but satisfies the "must have a filter" rule.
const NEVER_UUID = '00000000-0000-0000-0000-000000000000';

/**
 * FIX-2 one-shot admin operation:
 *   1. Close ALL open OANDA demo trades (flatten) and verify flat.
 *   2. Wipe the contaminated trading ledger via direct Supabase REST deletes.
 *      The service_role key bypasses RLS — no stored procedure required.
 *      Clean-data tables (candles, fx_rates, indicator_snapshots, broker_accounts,
 *      user_settings) are NEVER touched.
 *   3. Soft-clear all active system_halts rows.
 *   4. Re-baseline equity: write fresh HOURLY, DAILY_REF, WEEKLY_REF snapshots
 *      from the current OANDA equity so loss/drawdown breakers start clean.
 *
 * DEMO ONLY. No engine/risk/execution logic changes.
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

    // Step 1: Close all open trades at OANDA.
    const openTrades = await this.broker.getOpenTrades();
    let flattenedTrades = 0;
    for (const t of openTrades) {
      this.logger.log(`FIX-2 closing trade ${t.id} (${t.side} ${t.units} ${t.instrument})`);
      try {
        await this.broker.closeTrade(t.id);
        flattenedTrades++;
      } catch (err) {
        throw new Error(
          `Failed to close trade ${t.id}: ${String(err)}. Close manually on OANDA then retry.`,
        );
      }
    }

    // Step 2: Verify flat before touching the DB.
    const remaining = await this.broker.getOpenTrades();
    if (remaining.length > 0) {
      throw new Error(
        `Account not flat after close (${remaining.length} trade(s) remain). Retry once they settle.`,
      );
    }

    // Step 3: Wipe ledger tables. Delete in FK-safe order (leaf first).
    // Count each table first so the summary shows what was removed.
    const wipedCounts: Record<string, number> = {};
    await this.wipeTable('risk_events',       wipedCounts, async () => { const { error } = await this.supabase!.from('risk_events').delete().gt('id', 0);               if (error) throw error; });
    await this.wipeTable('equity_snapshots',  wipedCounts, async () => { const { error } = await this.supabase!.from('equity_snapshots').delete().gt('id', 0);          if (error) throw error; });
    await this.wipeTable('positions',         wipedCounts, async () => { const { error } = await this.supabase!.from('positions').delete().neq('id', NEVER_UUID);        if (error) throw error; });
    await this.wipeTable('orders',            wipedCounts, async () => { const { error } = await this.supabase!.from('orders').delete().neq('id', NEVER_UUID);           if (error) throw error; });
    await this.wipeTable('signals',           wipedCounts, async () => { const { error } = await this.supabase!.from('signals').delete().neq('id', NEVER_UUID);          if (error) throw error; });
    await this.wipeTable('performance_daily', wipedCounts, async () => { const { error } = await this.supabase!.from('performance_daily').delete().gte('day', '2000-01-01'); if (error) throw error; });

    // Step 4: Soft-clear all active system_halts.
    const { data: haltRows } = await this.supabase
      .from('system_halts')
      .select('halt_type')
      .eq('active', true);
    const haltsCleared = haltRows?.length ?? 0;
    if (haltsCleared > 0) {
      const { error: haltErr } = await this.supabase
        .from('system_halts')
        .update({ active: false, cleared_at: ts, updated_at: ts })
        .eq('active', true);
      if (haltErr) this.logger.warn(`halt clear failed: ${haltErr.message}`);
    }

    // Step 5: Re-baseline equity from the current live OANDA account.
    const account = await this.broker.getAccount();
    const equity = account.equity;

    const { data: ba } = await this.supabase
      .from('broker_accounts')
      .select('id')
      .eq('broker', 'OANDA')
      .eq('mode', 'demo')
      .limit(1);
    const brokerAccountId = ba?.[0]?.id ?? null;

    // Three snapshots sharing the same moment: HOURLY, DAILY_REF, WEEKLY_REF.
    // All carry high_water_mark = current equity so breakers start from scratch.
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

  /** Count rows in a table, run the delete, record the pre-wipe count. */
  private async wipeTable(
    table: string,
    counts: Record<string, number>,
    deleteFn: () => Promise<void>,
  ): Promise<void> {
    const { count } = await this.supabase!.from(table).select('*', { count: 'exact', head: true });
    try {
      await deleteFn();
    } catch (err: any) {
      throw new Error(`Failed to wipe ${table}: ${err?.message ?? String(err)}`);
    }
    counts[table] = count ?? 0;
    this.logger.log(`FIX-2 wiped ${counts[table]} rows from ${table}`);
  }
}
