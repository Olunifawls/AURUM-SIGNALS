import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../supabase/supabase.provider';
import { SystemEventsService } from '../common/system-events.service';
import { IndicatorsService } from '../indicators/indicators.service';
import { SignalsService } from '../signals/signals.service';
import { TrackerService } from '../tracker/tracker.service';
import { RateBudgetService } from './rate-budget.service';
import { CircuitBreakerRegistry } from './circuit-breaker';
import { OandaCandlesService, CandleRow } from './oanda-candles.service';
import { withRetry } from './resilience';
import { isGoldMarketOpen } from './market-hours';
import { computeStale } from './health-util';
import { EVENT_SOURCE, FX_PAIR, PROVIDER_OANDA, SYMBOL, TIMEFRAMES, Timeframe } from './ingestion.constants';

export interface IngestionHealth {
  ts: string;
  marketOpen: boolean;
  stale: boolean;
  timeframes: Record<string, { lastIngestionTs: string | null }>;
  fx: { lastTs: string | null };
  sources: Record<string, { consecutiveErrors: number; circuitOpen: boolean }>;
  rateBudget: ReturnType<RateBudgetService['snapshot']>;
}

/**
 * Ingestion pipeline (FIX-1): staggered per-timeframe crons pull XAU/USD candles
 * and GBP/USD FX from OANDA (the same feed we execute on) and store them. Only
 * COMPLETE bars are written, WRITE-ONCE (immutable) — a stored bar is never
 * overwritten. Post-ingestion compute (indicators / signals / tracker) runs with
 * each step ISOLATED so one failure can never abort the others.
 */
@Injectable()
export class IngestionService implements OnModuleInit {
  private readonly logger = new Logger('Ingestion');

  private readonly lastSuccess: Record<Timeframe, string | null> = {
    '15min': null,
    '1h': null,
    '4h': null,
    '1day': null,
  };
  private lastFxTs: string | null = null;

  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient | null,
    private readonly oanda: OandaCandlesService,
    private readonly events: SystemEventsService,
    private readonly rateBudget: RateBudgetService,
    private readonly breakers: CircuitBreakerRegistry,
    private readonly indicators: IndicatorsService,
    private readonly signals: SignalsService,
    private readonly tracker: TrackerService,
  ) {}

  onModuleInit(): void {
    void this.seed();
  }

  // ----------------------------------------------------------------- crons
  @Cron('*/5 * * * *')
  handle15min(): Promise<void> {
    return this.ingestTimeframe('15min');
  }
  @Cron('*/15 * * * *')
  handle1h(): Promise<void> {
    return this.ingestTimeframe('1h');
  }
  @Cron('0 * * * *')
  handle4h(): Promise<void> {
    return this.ingestTimeframe('4h');
  }
  @Cron('0 1 * * *')
  handle1day(): Promise<void> {
    return this.ingestTimeframe('1day');
  }
  @Cron('*/30 * * * *')
  handleFx(): Promise<void> {
    return this.ingestFx();
  }

  // --------------------------------------------------------------- startup
  /** Startup seed (bypasses the market-hours gate so tables populate immediately). */
  async seed(): Promise<void> {
    await this.events.info(EVENT_SOURCE, 'startup seed starting (OANDA source; market-hours gate bypassed for seed)');
    for (const tf of TIMEFRAMES) await this.ingestTimeframe(tf, { bypassGate: true });
    await this.ingestFx({ bypassGate: true });
    await this.events.info(EVENT_SOURCE, 'startup seed complete', { lastSuccess: this.lastSuccess, lastFxTs: this.lastFxTs });
  }

  // -------------------------------------------------------------- timeframe
  async ingestTimeframe(tf: Timeframe, opts: { bypassGate?: boolean } = {}): Promise<void> {
    const now = new Date();
    if (!opts.bypassGate && !isGoldMarketOpen(now)) {
      await this.events.info(EVENT_SOURCE, 'market closed, skipped', { timeframe: tf });
      return;
    }
    const breaker = this.breakers.get(PROVIDER_OANDA);
    if (breaker.isOpen()) {
      await this.events.warn(EVENT_SOURCE, 'circuit open for oanda, skipping cycle', { timeframe: tf, consecutiveFailures: breaker.consecutiveFailures });
      return;
    }

    try {
      const candles = await withRetry(() => this.oanda.fetchCandles(tf), { retries: 3 });
      const written = await this.storeCandlesImmutable(tf, candles);
      breaker.recordSuccess();
      this.lastSuccess[tf] = new Date().toISOString();
      this.logger.log(`ingested ${written} new ${tf} candles from OANDA (${candles.length} complete fetched)`);
    } catch (err) {
      breaker.recordFailure();
      await this.events.warn(EVENT_SOURCE, `oanda ${tf} fetch failed`, { timeframe: tf, error: String(err), consecutiveFailures: breaker.consecutiveFailures });
      return;
    }

    // Post-ingestion compute — each step ISOLATED (a failure in one can NEVER abort another).
    await this.runStep('indicators', tf, () => this.indicators.computeForTimeframe(tf));
    await this.runStep('signals', tf, () => this.signals.evaluateForTimeframe(tf));
    await this.runStep('tracker', tf, () => this.tracker.run());
  }

  private async runStep(step: string, tf: Timeframe, fn: () => Promise<unknown>): Promise<void> {
    try {
      await fn();
    } catch (err) {
      await this.events.warn(EVENT_SOURCE, `${step} step failed for ${tf}`, { step, timeframe: tf, error: String(err) });
    }
  }

  // --------------------------------------------------------------------- fx
  async ingestFx(opts: { bypassGate?: boolean } = {}): Promise<void> {
    const now = new Date();
    if (!opts.bypassGate && !isGoldMarketOpen(now)) {
      await this.events.info(EVENT_SOURCE, 'market closed, skipped', { source: 'fx' });
      return;
    }
    const breaker = this.breakers.get(PROVIDER_OANDA);
    if (breaker.isOpen()) return;
    try {
      const fx = await withRetry(() => this.oanda.fetchFx(), { retries: 3 });
      await this.upsertFx(fx.rate, fx.ts);
      breaker.recordSuccess();
      this.lastFxTs = new Date().toISOString();
      this.logger.log(`ingested FX ${FX_PAIR}=${fx.rate} from OANDA`);
    } catch (err) {
      breaker.recordFailure();
      await this.events.warn(EVENT_SOURCE, 'oanda FX fetch failed', { error: String(err), consecutiveFailures: breaker.consecutiveFailures });
    }
  }

  // ----------------------------------------------------------------- store
  /**
   * WRITE-ONCE store. `ignoreDuplicates: true` => INSERT ... ON CONFLICT DO
   * NOTHING, so an already-stored complete bar is NEVER overwritten (no mutation).
   */
  private async storeCandlesImmutable(tf: Timeframe, candles: CandleRow[]): Promise<number> {
    if (!this.supabase) throw new Error('Supabase client not configured');
    if (candles.length === 0) return 0;
    const rows = candles.map((c) => ({
      symbol: SYMBOL,
      timeframe: tf,
      ts: c.ts,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume,
    }));
    const { error, count } = await this.supabase
      .from('candles')
      .upsert(rows, { onConflict: 'symbol,timeframe,ts', ignoreDuplicates: true, count: 'exact' });
    if (error) throw new Error(`candles insert failed: ${error.message}`);
    return count ?? 0;
  }

  private async upsertFx(rate: number, ts: string): Promise<void> {
    if (!this.supabase) throw new Error('Supabase client not configured');
    const { error } = await this.supabase.from('fx_rates').upsert({ pair: FX_PAIR, rate, ts }, { onConflict: 'pair,ts', ignoreDuplicates: false });
    if (error) throw new Error(`fx_rates upsert failed: ${error.message}`);
  }

  // ----------------------------------------------------------------- health
  getHealth(): IngestionHealth {
    const now = new Date();
    const marketOpen = isGoldMarketOpen(now);
    return {
      ts: now.toISOString(),
      marketOpen,
      stale: computeStale(this.lastSuccess['15min'], now, marketOpen),
      timeframes: Object.fromEntries(TIMEFRAMES.map((tf) => [tf, { lastIngestionTs: this.lastSuccess[tf] }])),
      fx: { lastTs: this.lastFxTs },
      sources: this.breakers.snapshot(),
      rateBudget: this.rateBudget.snapshot(),
    };
  }
}
