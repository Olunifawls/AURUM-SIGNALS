import { Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../supabase/supabase.provider';
import { FX_PAIR, SYMBOL, TIMEFRAMES } from '../ingestion/ingestion.constants';
import {
  computePerformanceDaily,
  maxLosingStreak,
  RollupInput,
  SignalStatus,
} from '../tracker/performance';

/** D7 disclosure the UI must display alongside performance/prices. */
export const FEED_PRICE_NOTE = 'Results use data-feed prices, before spread and slippage.';

const SIGNAL_COLUMNS =
  'id,created_at,symbol,timeframe,direction,entry_price,stop_loss,take_profit,rr_ratio,' +
  'confluence_score,confluence_max,track,status,resolved_at,resolved_price,pips_result,' +
  'suggested_lots,risk_amount_ccy,sizing_note,tp_structure_capped,factors,notes';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

@Injectable()
export class ReadService {
  constructor(@Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient | null) {}

  private db(): SupabaseClient {
    if (!this.supabase) throw new Error('Supabase client not configured');
    return this.supabase;
  }

  async listSignals(status?: string, limit?: number): Promise<unknown[]> {
    const cap = Math.min(Math.max(1, Number(limit) || DEFAULT_LIMIT), MAX_LIMIT);
    let query = this.db()
      .from('signals')
      .select(SIGNAL_COLUMNS)
      .eq('symbol', SYMBOL)
      .order('created_at', { ascending: false })
      .limit(cap);
    if (status) query = query.eq('status', status);
    const { data, error } = await query;
    if (error) throw new Error(`signals query failed: ${error.message}`);
    return data ?? [];
  }

  async activeSignals(): Promise<unknown[]> {
    const { data, error } = await this.db()
      .from('signals')
      .select(SIGNAL_COLUMNS)
      .eq('symbol', SYMBOL)
      .eq('status', 'OPEN')
      .order('created_at', { ascending: false });
    if (error) throw new Error(`active signals query failed: ${error.message}`);
    return data ?? [];
  }

  /**
   * performance_daily rollups + headline stats. Reuses the INC-4 pure functions
   * (computePerformanceDaily / maxLosingStreak) over the signals table so the
   * numbers cannot diverge from the tracker's definitions.
   */
  async performance(): Promise<{
    daily: ReturnType<typeof computePerformanceDaily>;
    headline: {
      total_signals: number;
      resolved: number;
      wins: number;
      losses: number;
      expired: number;
      win_rate: number | null;
      avg_r_per_trade: number | null;
      cumulative_r: number;
      max_losing_streak: number;
    };
    note: string;
  }> {
    const { data, error } = await this.db()
      .from('signals')
      .select('created_at,resolved_at,status,entry_price,stop_loss,pips_result')
      .eq('symbol', SYMBOL);
    if (error) throw new Error(`performance query failed: ${error.message}`);
    const rows = data ?? [];

    const rollup: RollupInput[] = rows.map((r) => {
      const risk = Math.abs(Number(r.entry_price) - Number(r.stop_loss));
      const resolved = r.resolved_at != null;
      return {
        createdDate: (r.created_at as string).slice(0, 10),
        resolvedDate: resolved ? (r.resolved_at as string).slice(0, 10) : null,
        status: r.status as SignalStatus,
        rMultiple: resolved && risk !== 0 && r.pips_result != null ? Number(r.pips_result) / risk : null,
      };
    });

    const daily = computePerformanceDaily(rollup);
    const wins = daily.reduce((a, d) => a + d.wins, 0);
    const losses = daily.reduce((a, d) => a + d.losses, 0);
    const expired = daily.reduce((a, d) => a + d.expired, 0);
    const resolved = wins + losses + expired;
    const cumulative_r = daily.length ? daily[daily.length - 1].cumulative_r : 0;

    // max losing streak over resolved signals in resolution-time order.
    const resolvedStatuses = rows
      .filter((r) => r.resolved_at != null)
      .sort((a, b) => ((a.resolved_at as string) < (b.resolved_at as string) ? -1 : 1))
      .map((r) => r.status as SignalStatus);

    return {
      daily,
      headline: {
        total_signals: rows.length,
        resolved,
        wins,
        losses,
        expired,
        win_rate: wins + losses > 0 ? round2((wins / (wins + losses)) * 100) : null,
        avg_r_per_trade: resolved > 0 ? round2(cumulative_r / resolved) : null,
        cumulative_r,
        max_losing_streak: maxLosingStreak(resolvedStatuses),
      },
      note: FEED_PRICE_NOTE,
    };
  }

  async marketSnapshot(): Promise<unknown> {
    const db = this.db();
    // latest price = latest 15min candle close
    const priceRes = await db
      .from('candles')
      .select('ts,close')
      .eq('symbol', SYMBOL)
      .eq('timeframe', '15min')
      .order('ts', { ascending: false })
      .limit(1);
    if (priceRes.error) throw new Error(`price query failed: ${priceRes.error.message}`);
    const priceRow = priceRes.data?.[0];

    // latest indicator snapshot per timeframe
    const indRes = await db
      .from('indicator_snapshots')
      .select('timeframe,ts,rsi_14,macd,macd_signal,macd_hist,ema_20,ema_50,ema_200,atr_14,nearest_support,nearest_resistance')
      .eq('symbol', SYMBOL);
    if (indRes.error) throw new Error(`indicators query failed: ${indRes.error.message}`);
    const indicators: Record<string, unknown> = {};
    for (const tf of TIMEFRAMES) indicators[tf] = null;
    for (const row of indRes.data ?? []) indicators[row.timeframe as string] = row;

    // latest FX
    const fxRes = await db
      .from('fx_rates')
      .select('pair,rate,ts')
      .eq('pair', FX_PAIR)
      .order('ts', { ascending: false })
      .limit(1);
    if (fxRes.error) throw new Error(`fx query failed: ${fxRes.error.message}`);
    const fxRow = fxRes.data?.[0];

    return {
      symbol: SYMBOL,
      price: priceRow ? { value: Number(priceRow.close), ts: priceRow.ts } : null,
      indicators,
      fx: fxRow ? { pair: fxRow.pair, rate: Number(fxRow.rate), ts: fxRow.ts } : null,
      dataAsOf: priceRow?.ts ?? null,
      note: FEED_PRICE_NOTE,
    };
  }
}
