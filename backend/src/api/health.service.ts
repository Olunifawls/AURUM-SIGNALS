import { Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../supabase/supabase.provider';
import { FX_PAIR, SYMBOL, TIMEFRAMES } from '../ingestion/ingestion.constants';
import { isGoldMarketOpen } from '../ingestion/market-hours';
import { computeStale, STALE_THRESHOLD_MS } from '../ingestion/health-util';
import { IngestionService } from '../ingestion/ingestion.service';

export interface ApiHealth {
  ts: string;
  marketOpen: boolean;
  stale: boolean;
  staleThresholdMinutes: number;
  timeframes: Record<string, { lastIngestionTs: string | null }>;
  fx: { lastTs: string | null };
  sources: Record<string, { consecutiveErrors: number; circuitOpen: boolean }>;
}

/**
 * DB-backed health readout (formalizes the INC-1 endpoint). Last-ingestion is
 * read from the candles table (persistent across restarts); per-source error
 * counts come from the live circuit breakers. Stale = 15min feed >15 min old
 * during market hours (reuses the INC-1 computeStale).
 */
@Injectable()
export class HealthService {
  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient | null,
    private readonly ingestion: IngestionService,
  ) {}

  async getHealth(): Promise<ApiHealth> {
    if (!this.supabase) throw new Error('Supabase client not configured');
    const now = new Date();
    const marketOpen = isGoldMarketOpen(now);

    const timeframes: Record<string, { lastIngestionTs: string | null }> = {};
    for (const tf of TIMEFRAMES) {
      const { data } = await this.supabase
        .from('candles')
        .select('ts')
        .eq('symbol', SYMBOL)
        .eq('timeframe', tf)
        .order('ts', { ascending: false })
        .limit(1);
      timeframes[tf] = { lastIngestionTs: data?.[0]?.ts ?? null };
    }

    const { data: fxData } = await this.supabase
      .from('fx_rates')
      .select('ts')
      .eq('pair', FX_PAIR)
      .order('ts', { ascending: false })
      .limit(1);

    const last15 = timeframes['15min']?.lastIngestionTs ?? null;
    const stale = computeStale(last15, now, marketOpen);

    return {
      ts: now.toISOString(),
      marketOpen,
      stale,
      staleThresholdMinutes: STALE_THRESHOLD_MS / 60_000,
      timeframes,
      fx: { lastTs: fxData?.[0]?.ts ?? null },
      sources: this.ingestion.getHealth().sources,
    };
  }
}
