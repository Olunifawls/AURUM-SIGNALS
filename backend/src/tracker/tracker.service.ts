import { Inject, Injectable, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../supabase/supabase.provider';
import { SystemEventsService } from '../common/system-events.service';
import { AlertsService } from '../alerts/alerts.service';
import { SYMBOL } from '../ingestion/ingestion.constants';
import { Candle15, Direction, resolveSignal } from './resolution';
import { computePerformanceDaily, RollupInput, SignalStatus } from './performance';
import { computePathMetrics } from '../backtest/path-metrics';

const EVENT_SOURCE = 'tracker';

interface OpenSignalRow {
  id: string;
  direction: Direction;
  timeframe: string;
  track: string;
  entry_price: number;
  stop_loss: number;
  take_profit: number;
  created_at: string;
}

export interface TrackerRunResult {
  openBefore: number;
  resolved: number;
  performanceDays: number;
  resolutions: Array<{ id: string; status: string; rMultiple: number }>;
}

/**
 * Outcome tracker: resolves OPEN signals against 15min candles and recomputes
 * performance_daily. Idempotent — safe to run every cycle and on demand.
 */
@Injectable()
export class TrackerService {
  private readonly logger = new Logger('Tracker');

  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient | null,
    private readonly events: SystemEventsService,
    private readonly alerts: AlertsService,
  ) {}

  async run(now: string = new Date().toISOString()): Promise<TrackerRunResult> {
    if (!this.supabase) throw new Error('Supabase client not configured');

    const open = await this.fetchOpenSignals();
    const resolutions: TrackerRunResult['resolutions'] = [];

    for (const sig of open) {
      // entryTs = created_at: strictly-later 15min candles only (no look-ahead).
      const entryTs = sig.created_at;
      const candles = await this.fetch15mAfter(entryTs);
      const res = resolveSignal(
        {
          direction: sig.direction,
          entryPrice: Number(sig.entry_price),
          stopLoss: Number(sig.stop_loss),
          takeProfit: Number(sig.take_profit),
          entryTs,
        },
        candles,
        { now },
      );
      if (!res) continue;

      await this.applyResolution(sig.id, res);
      resolutions.push({ id: sig.id, status: res.status, rMultiple: res.rMultiple });
      // Non-blocking analytics — never affects trading flow.
      this.storePathMetrics(sig, res.resolvedTs, candles).catch(() => undefined);
      await this.events.info(
        EVENT_SOURCE,
        `resolved signal ${sig.id} -> ${res.status} (${res.rMultiple.toFixed(2)}R)`,
        { id: sig.id, status: res.status, resolvedPrice: res.resolvedPrice },
      );

      // INC-7: resolution Telegram alert. Isolated — never break tracking.
      try {
        await this.alerts.sendResolution({
          status: res.status,
          direction: sig.direction,
          timeframe: sig.timeframe,
          entry: Number(sig.entry_price),
          rMultiple: res.rMultiple,
          track: (sig.track === 'experimental' ? 'experimental' : 'core') as 'core' | 'experimental',
        });
      } catch (alertErr) {
        await this.events.warn(EVENT_SOURCE, `resolution alert failed for ${sig.id}`, {
          id: sig.id,
          error: String(alertErr),
        });
      }
    }

    const performanceDays = await this.recomputePerformance();

    if (resolutions.length > 0) {
      this.logger.log(`resolved ${resolutions.length}/${open.length} open signal(s)`);
    }
    return {
      openBefore: open.length,
      resolved: resolutions.length,
      performanceDays,
      resolutions,
    };
  }

  private async fetchOpenSignals(): Promise<OpenSignalRow[]> {
    const { data, error } = await this.supabase!
      .from('signals')
      .select('id,direction,timeframe,track,entry_price,stop_loss,take_profit,created_at')
      .eq('symbol', SYMBOL)
      .eq('status', 'OPEN')
      .order('created_at', { ascending: true });
    if (error) throw new Error(`open signals query failed: ${error.message}`);
    return (data ?? []) as OpenSignalRow[];
  }

  private async fetch15mAfter(entryTs: string): Promise<Candle15[]> {
    const { data, error } = await this.supabase!
      .from('candles')
      .select('ts,open,high,low,close')
      .eq('symbol', SYMBOL)
      .eq('timeframe', '15min')
      .gt('ts', entryTs)
      .order('ts', { ascending: true })
      .limit(5000);
    if (error) throw new Error(`15min candles query failed: ${error.message}`);
    return (data ?? []).map((r) => ({
      ts: r.ts as string,
      open: Number(r.open),
      high: Number(r.high),
      low: Number(r.low),
      close: Number(r.close),
    }));
  }

  private async applyResolution(
    id: string,
    res: { status: string; resolvedTs: string; resolvedPrice: number; pipsResult: number; notes: string | null },
  ): Promise<void> {
    const { error } = await this.supabase!
      .from('signals')
      .update({
        status: res.status,
        resolved_at: res.resolvedTs,
        resolved_price: res.resolvedPrice,
        pips_result: res.pipsResult,
        notes: res.notes,
      })
      .eq('id', id);
    if (error) throw new Error(`signal resolution update failed: ${error.message}`);
  }

  /** Store MFE/MAE and R-crossing timestamps for a resolved signal. Research analytics only. */
  private async storePathMetrics(
    sig: OpenSignalRow,
    resolvedTs: string,
    allCandles: Candle15[],
  ): Promise<void> {
    if (!this.supabase) return;
    const pathCandles = allCandles.filter((c) => c.ts <= resolvedTs);
    const pm = computePathMetrics(
      sig.direction,
      Number(sig.entry_price),
      Number(sig.stop_loss),
      pathCandles,
    );
    await this.supabase.from('signal_path_metrics').upsert(
      {
        signal_id: sig.id,
        direction: sig.direction,
        entry_price: sig.entry_price,
        initial_sl: sig.stop_loss,
        take_profit: sig.take_profit,
        mfe_r: pm.mfe_r,
        mae_r: pm.mae_r,
        cross_0_5r_ts: pm.cross_0_5r_ts,
        cross_1r_ts: pm.cross_1r_ts,
        cross_1_5r_ts: pm.cross_1_5r_ts,
        cross_2r_ts: pm.cross_2r_ts,
        retraced_from_1r: pm.retraced_from_1r,
        retraced_from_1_5r: pm.retraced_from_1_5r,
        candles_in_path: pm.candles_in_path,
        computed_at: new Date().toISOString(),
      },
      { onConflict: 'signal_id' },
    );
  }

  /** Recompute the full performance_daily table (delete-all + insert; it is derived). */
  private async recomputePerformance(): Promise<number> {
    const { data, error } = await this.supabase!
      .from('signals')
      .select('created_at,resolved_at,status,entry_price,stop_loss,pips_result')
      .eq('symbol', SYMBOL);
    if (error) throw new Error(`signals rollup query failed: ${error.message}`);

    const rows: RollupInput[] = (data ?? []).map((r) => {
      const risk = Math.abs(Number(r.entry_price) - Number(r.stop_loss));
      const resolved = r.resolved_at != null;
      const rMultiple =
        resolved && risk !== 0 && r.pips_result != null ? Number(r.pips_result) / risk : null;
      return {
        createdDate: (r.created_at as string).slice(0, 10),
        resolvedDate: resolved ? (r.resolved_at as string).slice(0, 10) : null,
        status: r.status as SignalStatus,
        rMultiple,
      };
    });

    const perf = computePerformanceDaily(rows);

    // Rebuild the derived table from scratch.
    const del = await this.supabase!.from('performance_daily').delete().neq('day', '1900-01-01');
    if (del.error) throw new Error(`performance_daily clear failed: ${del.error.message}`);

    if (perf.length > 0) {
      // UPSERT on the primary key `day` (not INSERT): the tracker runs from several
      // staggered ingestion cycles, so concurrent recomputes previously collided on
      // performance_daily_pkey. Upsert is race-safe and idempotent.
      const ins = await this.supabase!.from('performance_daily').upsert(perf, { onConflict: 'day' });
      if (ins.error) throw new Error(`performance_daily upsert failed: ${ins.error.message}`);
    }
    return perf.length;
  }
}
