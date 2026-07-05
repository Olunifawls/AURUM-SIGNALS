import { Inject, Injectable, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../supabase/supabase.provider';
import { SystemEventsService } from '../common/system-events.service';
import { SYMBOL, Timeframe } from '../ingestion/ingestion.constants';
import { Candle } from '../indicators/support-resistance';
import {
  CONFLUENCE_MAX,
  CORE_STOP,
  DAILY_GUARD_MIN,
  Direction,
  EXPERIMENTAL_STOP,
  HIGHER_TF,
  MIN_CONFLUENCE_EXPERIMENTAL,
  experimental15mEnabled,
  minConfluenceCore,
  minRrRatio,
} from './signals.constants';
import { evaluateFromCandles, EvaluationResult } from './signal-engine';
import { SizingService } from '../sizing/sizing.service';

const EVENT_SOURCE = 'signals';
const FETCH_LIMIT = 500;

export interface EvaluateOutcome {
  timeframe: Timeframe;
  evaluated: boolean;
  fired: boolean;
  reason?: string;
  track?: 'core' | 'experimental';
  direction?: Direction;
  score?: number;
  signalId?: string;
  entry?: number;
  stop?: number;
  takeProfit?: number;
  rr?: number;
}

interface TrackConfig {
  track: 'core' | 'experimental';
  minScore: number;
  stopFloorMult: number;
  stopCeilMult: number;
}

@Injectable()
export class SignalsService {
  private readonly logger = new Logger('Signals');

  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient | null,
    private readonly events: SystemEventsService,
    private readonly sizing: SizingService,
  ) {}

  private trackConfig(tf: Timeframe): TrackConfig | null {
    if (tf === '1h' || tf === '4h') {
      return { track: 'core', minScore: minConfluenceCore(), stopFloorMult: CORE_STOP.floor, stopCeilMult: CORE_STOP.ceil };
    }
    if (tf === '15min') {
      if (!experimental15mEnabled()) return null;
      return {
        track: 'experimental',
        minScore: MIN_CONFLUENCE_EXPERIMENTAL,
        stopFloorMult: EXPERIMENTAL_STOP.floor,
        stopCeilMult: EXPERIMENTAL_STOP.ceil,
      };
    }
    return null; // 1day and anything else are not traded here
  }

  private async fetchCandles(tf: Timeframe): Promise<Candle[]> {
    if (!this.supabase) throw new Error('Supabase client not configured');
    const { data, error } = await this.supabase
      .from('candles')
      .select('ts,open,high,low,close,volume')
      .eq('symbol', SYMBOL)
      .eq('timeframe', tf)
      .order('ts', { ascending: false })
      .limit(FETCH_LIMIT);
    if (error) throw new Error(`candles query failed: ${error.message}`);
    return (data ?? [])
      .map((r) => ({
        ts: r.ts as string,
        open: Number(r.open),
        high: Number(r.high),
        low: Number(r.low),
        close: Number(r.close),
        volume: r.volume == null ? null : Number(r.volume),
      }))
      .reverse();
  }

  private async countCandles(tf: Timeframe): Promise<number> {
    if (!this.supabase) throw new Error('Supabase client not configured');
    const { count, error } = await this.supabase
      .from('candles')
      .select('id', { count: 'exact', head: true })
      .eq('symbol', SYMBOL)
      .eq('timeframe', tf);
    if (error) throw new Error(`candles count failed: ${error.message}`);
    return count ?? 0;
  }

  private async openDirections(tf: Timeframe): Promise<Direction[]> {
    if (!this.supabase) throw new Error('Supabase client not configured');
    const { data, error } = await this.supabase
      .from('signals')
      .select('direction')
      .eq('symbol', SYMBOL)
      .eq('timeframe', tf)
      .eq('status', 'OPEN');
    if (error) throw new Error(`open signals query failed: ${error.message}`);
    return (data ?? []).map((r) => r.direction as Direction);
  }

  /**
   * Evaluate the signal engine for a timeframe and INSERT a signal if it fires.
   * Non-traded timeframes and the 4h guard short-circuit with `evaluated:false`.
   */
  async evaluateForTimeframe(tf: Timeframe): Promise<EvaluateOutcome> {
    const cfg = this.trackConfig(tf);
    if (!cfg) {
      return { timeframe: tf, evaluated: false, fired: false, reason: 'timeframe_not_traded' };
    }

    const higherTf = HIGHER_TF[tf];
    if (!higherTf) {
      return { timeframe: tf, evaluated: false, fired: false, reason: 'no_higher_timeframe' };
    }

    // 4h GUARD (D9): disabled until >= 200 daily candles exist.
    if (tf === '4h') {
      const dailyCount = await this.countCandles('1day');
      if (dailyCount < DAILY_GUARD_MIN) {
        await this.events.info(
          EVENT_SOURCE,
          `4h guard: disabled (${dailyCount} < ${DAILY_GUARD_MIN} daily candles)`,
          { timeframe: tf, dailyCount },
        );
        return { timeframe: tf, evaluated: false, fired: false, reason: '4h_guard', track: cfg.track };
      }
    }

    const [signalCandles, higherCandles, existingOpen] = await Promise.all([
      this.fetchCandles(tf),
      this.fetchCandles(higherTf),
      this.openDirections(tf),
    ]);

    const result = evaluateFromCandles(signalCandles, higherCandles, {
      minScore: cfg.minScore,
      minRr: minRrRatio(),
      stopFloorMult: cfg.stopFloorMult,
      stopCeilMult: cfg.stopCeilMult,
      existingOpenDirections: existingOpen,
    });

    if (result.reason === 'insufficient_higher_data' && tf === '4h') {
      await this.events.info(EVENT_SOURCE, '4h guard: insufficient daily data for F1', { timeframe: tf });
      return { timeframe: tf, evaluated: false, fired: false, reason: '4h_guard', track: cfg.track };
    }

    if (!result.fired) {
      this.logger.log(`${tf} (${cfg.track}): no signal — ${result.reason}`);
      return {
        timeframe: tf,
        evaluated: true,
        fired: false,
        reason: result.reason,
        track: cfg.track,
        direction: result.direction ?? undefined,
        score: result.score ?? undefined,
      };
    }

    const signalId = await this.insertSignal(tf, cfg.track, result);
    await this.events.info(
      EVENT_SOURCE,
      `${tf} (${cfg.track}) ${result.direction} signal fired score=${result.score}/${CONFLUENCE_MAX} rr=${result.levels!.rr.toFixed(2)}`,
      { timeframe: tf, direction: result.direction, score: result.score, signalId },
    );
    this.logger.log(`${tf} (${cfg.track}): ${result.direction} FIRED score=${result.score} id=${signalId}`);

    return {
      timeframe: tf,
      evaluated: true,
      fired: true,
      track: cfg.track,
      direction: result.direction!,
      score: result.score!,
      signalId,
      entry: result.levels!.entry,
      stop: result.levels!.stop,
      takeProfit: result.levels!.takeProfit,
      rr: result.levels!.rr,
    };
  }

  private buildFactorsJson(
    tf: Timeframe,
    track: 'core' | 'experimental',
    result: EvaluationResult,
  ): Record<string, unknown> {
    const f = result.factors!;
    const lv = result.levels!;
    return {
      direction: result.direction,
      track,
      higher_timeframe: HIGHER_TF[tf],
      score: f.score,
      max: CONFLUENCE_MAX,
      F1_trend_higher: f.F1,
      F2_trend_local: f.F2,
      F3_rsi: f.F3,
      F4_macd: f.F4,
      F5_structure: f.F5,
      F6_momentum: f.F6,
      tp_beyond_structure: lv.tpBeyondStructure,
      tp_structure_capped: lv.tpStructureCapped,
    };
  }

  private async insertSignal(
    tf: Timeframe,
    track: 'core' | 'experimental',
    result: EvaluationResult,
  ): Promise<string> {
    if (!this.supabase) throw new Error('Supabase client not configured');
    const lv = result.levels!;
    const factors = this.buildFactorsJson(tf, track, result);

    // INC-6: position sizing from current user_settings + latest FX.
    const sizing = await this.sizing.computeForSignal(lv.entry, lv.stop, lv.takeProfit);

    const { data, error } = await this.supabase
      .from('signals')
      .insert({
        symbol: SYMBOL,
        timeframe: tf,
        direction: result.direction,
        entry_price: lv.entry,
        stop_loss: lv.stop,
        take_profit: lv.takeProfit,
        rr_ratio: lv.rr,
        confluence_score: result.score,
        confluence_max: CONFLUENCE_MAX,
        track,
        factors,
        status: 'OPEN',
        tp_structure_capped: lv.tpStructureCapped,
        suggested_lots: sizing.suggested_lots,
        risk_amount_ccy: sizing.risk_amount_ccy,
        sizing_note: sizing.sizing_note,
      })
      .select('id')
      .single();
    if (error) throw new Error(`signal insert failed: ${error.message}`);
    return (data as { id: string }).id;
  }
}
