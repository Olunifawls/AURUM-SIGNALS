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
import { TwelveDataService, CandleRow } from './twelve-data.service';
import { GoldApiService } from './gold-api.service';
import { withRetry } from './resilience';
import { isGoldMarketOpen } from './market-hours';
import { computeStale } from './health-util';
import {
  EVENT_SOURCE,
  FX_PAIR,
  PROVIDER_GOLD_API,
  PROVIDER_TWELVE_DATA,
  SYMBOL,
  TIMEFRAMES,
  Timeframe,
} from './ingestion.constants';

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
 * INC-1 ingestion pipeline: staggered per-timeframe crons pull XAU/USD candles
 * and GBP/USD FX from Twelve Data and upsert them into Supabase. All external
 * calls go through retry + timeout + circuit-breaker; a Twelve Data outage
 * triggers a GoldAPI liveness fallback. No indicators / signals here.
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
    private readonly twelveData: TwelveDataService,
    private readonly goldApi: GoldApiService,
    private readonly events: SystemEventsService,
    private readonly rateBudget: RateBudgetService,
    private readonly breakers: CircuitBreakerRegistry,
    private readonly indicators: IndicatorsService,
    private readonly signals: SignalsService,
    private readonly tracker: TrackerService,
  ) {}

  onModuleInit(): void {
    // Fire-and-forget so a slow/failing provider never blocks or crashes boot.
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

  @Cron('0 0 * * *')
  async dailyRollup(): Promise<void> {
    const snap = this.rateBudget.snapshot();
    await this.events.info(
      EVENT_SOURCE,
      `daily rate-budget rollup: ${JSON.stringify(snap.counts)} ` +
        `(nominal ${snap.estimateNominalPerDay}/day, gated avg ${snap.estimateGatedPerDay}/day, limit ${snap.dailyLimit})`,
      snap,
    );
  }

  // --------------------------------------------------------------- startup
  /**
   * Startup seed. DELIBERATE CHOICE: the seed BYPASSES the market-hours gate so
   * the tables are populated immediately even on a weekend (INC-2 indicators
   * need >= 250 candles to build on). Regular crons still respect the gate.
   */
  async seed(): Promise<void> {
    await this.events.info(EVENT_SOURCE, 'startup seed starting (market-hours gate bypassed for seed)');
    for (const tf of TIMEFRAMES) {
      await this.ingestTimeframe(tf, { bypassGate: true });
    }
    await this.ingestFx({ bypassGate: true });
    await this.events.info(EVENT_SOURCE, 'startup seed complete', {
      lastSuccess: this.lastSuccess,
      lastFxTs: this.lastFxTs,
    });
  }

  // -------------------------------------------------------------- timeframe
  async ingestTimeframe(tf: Timeframe, opts: { bypassGate?: boolean } = {}): Promise<void> {
    const now = new Date();
    if (!opts.bypassGate && !isGoldMarketOpen(now)) {
      await this.events.info(EVENT_SOURCE, 'market closed, skipped', { timeframe: tf });
      return;
    }

    const breaker = this.breakers.get(PROVIDER_TWELVE_DATA);
    if (breaker.isOpen()) {
      await this.events.warn(EVENT_SOURCE, 'circuit open for twelvedata, skipping cycle', {
        timeframe: tf,
        consecutiveFailures: breaker.consecutiveFailures,
      });
      return;
    }

    try {
      const candles = await withRetry(() => this.twelveData.fetchTimeSeries(tf), { retries: 3 });
      const count = await this.upsertCandles(tf, candles);
      breaker.recordSuccess();
      this.lastSuccess[tf] = new Date().toISOString();
      this.logger.log(`ingested ${count} ${tf} candles`);

      // INC-2: compute indicator snapshot for this timeframe. Failures here must
      // not affect ingestion, so they are caught and logged separately.
      try {
        await this.indicators.computeForTimeframe(tf);
        // INC-3: run the signal engine for this timeframe (service decides which
        // timeframes are traded). Isolated from ingestion the same way.
        await this.signals.evaluateForTimeframe(tf);
        // INC-4: resolve OPEN signals + recompute performance_daily. Idempotent,
        // so running it each cycle is safe.
        await this.tracker.run();
      } catch (indErr) {
        await this.events.warn(EVENT_SOURCE, `post-ingestion compute failed for ${tf}`, {
          timeframe: tf,
          error: String(indErr),
        });
      }
    } catch (err) {
      breaker.recordFailure();
      await this.events.warn(EVENT_SOURCE, `twelvedata ${tf} fetch failed`, {
        timeframe: tf,
        error: String(err),
        consecutiveFailures: breaker.consecutiveFailures,
      });
      if (breaker.justTripped()) {
        await this.runFallback();
      }
    }
  }

  // --------------------------------------------------------------------- fx
  async ingestFx(opts: { bypassGate?: boolean } = {}): Promise<void> {
    const now = new Date();
    if (!opts.bypassGate && !isGoldMarketOpen(now)) {
      await this.events.info(EVENT_SOURCE, 'market closed, skipped', { source: 'fx' });
      return;
    }

    const breaker = this.breakers.get(PROVIDER_TWELVE_DATA);
    if (breaker.isOpen()) {
      await this.events.warn(EVENT_SOURCE, 'circuit open for twelvedata, skipping FX cycle', {
        consecutiveFailures: breaker.consecutiveFailures,
      });
      return;
    }

    try {
      const fx = await withRetry(() => this.twelveData.fetchExchangeRate(), { retries: 3 });
      await this.upsertFx(fx.rate, fx.ts);
      breaker.recordSuccess();
      this.lastFxTs = new Date().toISOString();
      this.logger.log(`ingested FX ${FX_PAIR}=${fx.rate}`);
    } catch (err) {
      breaker.recordFailure();
      await this.events.warn(EVENT_SOURCE, 'twelvedata FX fetch failed', {
        error: String(err),
        consecutiveFailures: breaker.consecutiveFailures,
      });
      if (breaker.justTripped()) {
        await this.runFallback();
      }
    }
  }

  // --------------------------------------------------------------- fallback
  /**
   * Liveness fallback: Twelve Data has failed the threshold consecutive times.
   * Fetch a GoldAPI spot price and record it as a WARN. We do NOT fabricate
   * candles from it.
   */
  private async runFallback(): Promise<void> {
    const goldBreaker = this.breakers.get(PROVIDER_GOLD_API);
    try {
      const spot = await withRetry(() => this.goldApi.fetchSpot(), { retries: 3 });
      goldBreaker.recordSuccess();
      await this.events.warn(
        EVENT_SOURCE,
        `Twelve Data unavailable; GoldAPI fallback spot ${SYMBOL}=${spot}`,
        { provider: PROVIDER_GOLD_API, spot },
      );
    } catch (err) {
      goldBreaker.recordFailure();
      await this.events.warn(
        EVENT_SOURCE,
        'Twelve Data unavailable AND GoldAPI fallback failed',
        { provider: PROVIDER_GOLD_API, error: String(err) },
      );
    }
  }

  // ----------------------------------------------------------------- upsert
  private async upsertCandles(tf: Timeframe, candles: CandleRow[]): Promise<number> {
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

    const { error } = await this.supabase
      .from('candles')
      .upsert(rows, { onConflict: 'symbol,timeframe,ts', ignoreDuplicates: false });
    if (error) throw new Error(`candles upsert failed: ${error.message}`);
    return rows.length;
  }

  private async upsertFx(rate: number, ts: string): Promise<void> {
    if (!this.supabase) throw new Error('Supabase client not configured');
    const { error } = await this.supabase
      .from('fx_rates')
      .upsert({ pair: FX_PAIR, rate, ts }, { onConflict: 'pair,ts', ignoreDuplicates: false });
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
      timeframes: Object.fromEntries(
        TIMEFRAMES.map((tf) => [tf, { lastIngestionTs: this.lastSuccess[tf] }]),
      ),
      fx: { lastTs: this.lastFxTs },
      sources: this.breakers.snapshot(),
      rateBudget: this.rateBudget.snapshot(),
    };
  }
}
