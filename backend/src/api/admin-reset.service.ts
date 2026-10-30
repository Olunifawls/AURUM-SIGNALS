import { Inject, Injectable, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../supabase/supabase.provider';
import { BROKER_ADAPTER, IBrokerAdapter } from '../broker/broker.interface';

export interface PurgeTestArtifactsResult {
  positions: number;
  orders: number;
  riskEvents: number;
  haltsCleared: number;
  performanceDaily: number;
}

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
 *   1. Close ALL open OANDA demo trades (flatten) and verify flat.
 *   2. Archive then wipe the contaminated trading ledger, atomically, via
 *      archive_and_wipe_ledger (migration 0010). Rows move to ledger_archive.
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

  /**
   * Surgical purge of test artifacts. Moves the synthetic test position
   * (entry ≈ 4100 / broker trade 78) and its linked order, ALL risk_events
   * (there are zero real trades so every event is synthetic) and performance_daily
   * (derived; tracker rebuilds it clean from real signals) to ledger_archive,
   * and clears all active system_halts set during breaker verification.
   * Equity snapshots and signals are NEVER touched.
   */
  async purgeTestArtifacts(): Promise<PurgeTestArtifactsResult> {
    if (!this.supabase) throw new Error('Supabase not configured');
    await this.assertArchiveReady();
    const ts = new Date().toISOString();

    // 1. Find test positions (entry_price near 4100 or broker_trade_id = '78').
    const { data: testPos } = await this.supabase
      .from('positions')
      .select('id,order_id')
      .or('broker_trade_id.eq.78,and(entry_price.gte.4099,entry_price.lte.4101)')
      .eq('mode', 'demo');
    const posIds = (testPos ?? []).map((p: { id: string }) => p.id);
    const orderIds = (testPos ?? [])
      .map((p: { order_id: string | null }) => p.order_id)
      .filter((id): id is string => !!id);

    // 2. Archive and remove test positions, linked orders, ALL risk_events and
    //    performance_daily in one transaction.
    const { data: purged, error: purgeErr } = await this.supabase.rpc('archive_test_artifacts', {
      p_reason: 'purge-test-artifacts',
      p_position_ids: posIds,
      p_order_ids: orderIds,
    });
    if (purgeErr) throw new Error(`Archive failed: ${purgeErr.message}`);
    const positions = Number(purged?.positions ?? 0);
    const orders = Number(purged?.orders ?? 0);
    const { count: riskEvents } = await this.supabase
      .from('risk_events')
      .select('*', { count: 'exact', head: true });

    // 3. Soft-clear all active system_halts.
    const { data: activeHalts } = await this.supabase
      .from('system_halts')
      .select('id')
      .eq('active', true);
    const haltsCleared = activeHalts?.length ?? 0;
    if (haltsCleared > 0) {
      await this.supabase
        .from('system_halts')
        .update({ active: false, cleared_at: ts, updated_at: ts })
        .eq('active', true);
    }

    const { count: performanceDaily } = await this.supabase
      .from('performance_daily')
      .select('*', { count: 'exact', head: true });

    this.logger.log(
      `purge-test-artifacts: positions=${positions} orders=${orders} riskEvents deleted haltsCleared=${haltsCleared}`,
    );
    return { positions, orders, riskEvents: riskEvents ?? 0, haltsCleared, performanceDaily: performanceDaily ?? 0 };
  }

  async ledgerReset(): Promise<LedgerResetResult> {
    if (!this.supabase) throw new Error('Supabase not configured');
    await this.assertArchiveReady(); // before any trade is closed at the broker
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

    // Step 3: Archive then wipe the ledger tables in one transaction.
    const { data: archived, error: archiveErr } = await this.supabase.rpc('archive_and_wipe_ledger', { p_reason: 'ledger-reset' });
    if (archiveErr) throw new Error(`Archive failed: ${archiveErr.message}`);
    const { batch_id: batchId, ...wipedCounts } = archived as Record<string, number> & { batch_id?: string };
    this.logger.log(`FIX-2 archived ledger as batch ${batchId}: ${JSON.stringify(wipedCounts)}`);

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

  /** Refuse early if migration 0010 is missing, so nothing is destroyed or closed. */
  private async assertArchiveReady(): Promise<void> {
    const { error } = await this.supabase!.from('ledger_archive').select('id', { count: 'exact', head: true });
    if (error) throw new Error(`Ledger archive unavailable (apply migration 0010_ledger_archive): ${error.message}`);
  }
}
