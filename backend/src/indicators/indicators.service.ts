import { Inject, Injectable, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../supabase/supabase.provider';
import { SystemEventsService } from '../common/system-events.service';
import { SYMBOL, Timeframe } from '../ingestion/ingestion.constants';
import { Candle } from './support-resistance';
import { computeIndicators, IndicatorValues, MIN_CANDLES } from './indicators';

const EVENT_SOURCE = 'indicators';
/** Enough history for EMA-200 warmup plus MIN_CANDLES headroom. */
const FETCH_LIMIT = 500;

@Injectable()
export class IndicatorsService {
  private readonly logger = new Logger('Indicators');

  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient | null,
    private readonly events: SystemEventsService,
  ) {}

  /**
   * Load candles for a timeframe, compute the latest indicator values, and
   * write a single current row into indicator_snapshots. Returns null (and logs
   * an INFO) when there is not enough data.
   */
  async computeForTimeframe(tf: Timeframe): Promise<IndicatorValues | null> {
    if (!this.supabase) throw new Error('Supabase client not configured');

    const { data, error } = await this.supabase
      .from('candles')
      .select('ts,open,high,low,close,volume')
      .eq('symbol', SYMBOL)
      .eq('timeframe', tf)
      .order('ts', { ascending: false })
      .limit(FETCH_LIMIT);
    if (error) throw new Error(`candles query failed: ${error.message}`);

    // Postgres numeric comes back as strings — coerce, and put in ascending order.
    const candles: Candle[] = (data ?? [])
      .map((r) => ({
        ts: r.ts as string,
        open: Number(r.open),
        high: Number(r.high),
        low: Number(r.low),
        close: Number(r.close),
        volume: r.volume == null ? null : Number(r.volume),
      }))
      .reverse();

    if (candles.length < MIN_CANDLES) {
      await this.events.info(
        EVENT_SOURCE,
        `insufficient candles for ${tf} (${candles.length} < ${MIN_CANDLES}); skipping indicator snapshot`,
        { timeframe: tf, count: candles.length },
      );
      return null;
    }

    const values = computeIndicators(candles);
    if (!values) return null;

    await this.replaceSnapshot(tf, values);
    this.logger.log(
      `indicators ${tf}: rsi=${values.rsi_14?.toFixed(2)} macd=${values.macd?.toFixed(4)} ema200=${values.ema_200?.toFixed(2)}`,
    );
    return values;
  }

  /**
   * Keep exactly one CURRENT snapshot per (symbol, timeframe). indicator_snapshots
   * has no natural unique key, so we replace (delete + insert) rather than add a
   * schema constraint. Simplest option consistent with "one current row per tf".
   */
  private async replaceSnapshot(tf: Timeframe, v: IndicatorValues): Promise<void> {
    if (!this.supabase) throw new Error('Supabase client not configured');

    const del = await this.supabase
      .from('indicator_snapshots')
      .delete()
      .eq('symbol', SYMBOL)
      .eq('timeframe', tf);
    if (del.error) throw new Error(`indicator_snapshots delete failed: ${del.error.message}`);

    const ins = await this.supabase.from('indicator_snapshots').insert({
      symbol: SYMBOL,
      timeframe: tf,
      ts: v.ts,
      rsi_14: v.rsi_14,
      macd: v.macd,
      macd_signal: v.macd_signal,
      macd_hist: v.macd_hist,
      ema_20: v.ema_20,
      ema_50: v.ema_50,
      ema_200: v.ema_200,
      atr_14: v.atr_14,
      nearest_support: v.nearest_support,
      nearest_resistance: v.nearest_resistance,
    });
    if (ins.error) throw new Error(`indicator_snapshots insert failed: ${ins.error.message}`);
  }
}
