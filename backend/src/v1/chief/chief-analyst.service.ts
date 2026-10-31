import { Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { BROKER_ADAPTER, IBrokerAdapter } from '../../broker/broker.interface';
import { SUPABASE_CLIENT } from '../../supabase/supabase.provider';
import { SystemEventsService } from '../../common/system-events.service';
import { CotReport, DailyBar, Direction } from '../agents/types';
import { effectiveSchedule } from '../calendar/economic-calendar';
import { MacroInstrument, V1DataService } from '../data/v1-data.service';
import { DAY_MS } from '../v1.constants';
import { AiSummaryService } from './ai-summary.service';
import { AgentData, Evaluation, evaluateSignal, markDuplicate, SignalToEvaluate } from './chief-analyst';
import { findOriginal, SetupRow } from './duplicate';
import { lastClosedCandle, quotePrice } from '../ledger/forward-test';

const EVENT_SOURCE = 'chief-analyst';
/** OANDA can flag the daily bar complete a few seconds after 00:00 UTC, when a 4h
 * signal may also fire. Wait this long for it rather than judge on a bar-old view. */
const BAR_WAIT_ATTEMPTS = 3;
const BAR_WAIT_MS = 5_000;
const OANDA_INSTRUMENT = 'XAU_USD';
const SETUP_COLUMNS = 'id,symbol,timeframe,direction,entry_price,stop_loss,take_profit,created_at';

interface FirePrice {
  price: number;
  source: 'QUOTE' | 'CANDLE';
}

export interface StoredEvaluation extends Evaluation {
  aiSummary: string | null;
}

/**
 * Runs all agents for one L1 signal and stores one evaluation. Eligibility is written
 * before the AI summary is requested, so a summary can never delay or change it.
 */
@Injectable()
export class ChiefAnalystService {
  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient | null,
    private readonly data: V1DataService,
    private readonly ai: AiSummaryService,
    private readonly events: SystemEventsService,
    @Inject(BROKER_ADAPTER) private readonly broker: IBrokerAdapter,
  ) {}

  protected wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async evaluate(signalId: string, signal: SignalToEvaluate, now: () => Date = () => new Date()): Promise<StoredEvaluation> {
    const quote = await this.liveQuote(signal.direction); // first: the waits below would age it
    await this.refreshToLatestBar(now());
    const judged = evaluateSignal(signal, await this.loadData(), now());
    const stored = await this.loadSetup(signalId);
    const original = await this.originalOf(stored);
    const evaluation = original ? markDuplicate(judged, original.id, original.created_at) : judged;
    await this.store(signalId, evaluation, stored.created_at, quote ?? (await this.candlePrice(stored)));

    const summary = original ? null : await this.ai.summarise(evaluation.evidence);
    if (summary) await this.storeSummary(signalId, summary.text, summary.model);
    return { ...evaluation, aiSummary: summary?.text ?? null };
  }

  /** The price the executor would face now. A quote failure is not fatal: the ledger
   * falls back to the last closed candle. */
  private async liveQuote(side: Direction): Promise<FirePrice | null> {
    try {
      const { bid, ask } = await this.broker.getPricing(OANDA_INSTRUMENT);
      const price = quotePrice(side, bid, ask);
      return price == null ? null : { price, source: 'QUOTE' };
    } catch (err) {
      await this.events.warn(EVENT_SOURCE, 'no quote for fire price', { error: String(err) });
      return null;
    }
  }

  /** No quote: the close of the last 15min candle finished by the signal's time. */
  private async candlePrice(signal: SetupRow): Promise<FirePrice | null> {
    const { data, error } = await this.supabase!
      .from('candles')
      .select('ts,close')
      .eq('symbol', signal.symbol)
      .eq('timeframe', '15min')
      .lte('ts', signal.created_at)
      .order('ts', { ascending: false })
      .limit(2);
    if (error) return null;
    const close = lastClosedCandle((data ?? []) as Array<{ ts: string; close: number | string }>, signal.created_at);
    return close == null ? null : { price: close, source: 'CANDLE' };
  }

  /** A failed read throws, so the signal has no evaluation and cannot execute. */
  private async loadSetup(signalId: string): Promise<SetupRow> {
    if (!this.supabase) throw new Error('Supabase client not configured');
    const { data: rows, error } = await this.supabase.from('signals').select(SETUP_COLUMNS).eq('id', signalId).limit(1);
    if (error) throw new Error(`signal read failed: ${error.message}`);
    const signal = rows?.[0] as SetupRow | undefined;
    if (!signal) throw new Error(`signal ${signalId} not found`);
    return signal;
  }

  /** Compares stored rows, not the engine's unrounded levels. */
  private async originalOf(signal: SetupRow): Promise<SetupRow | null> {
    const { data: same, error: sameError } = await this.supabase!
      .from('signals')
      .select(SETUP_COLUMNS)
      .eq('symbol', signal.symbol)
      .eq('timeframe', signal.timeframe)
      .eq('direction', signal.direction)
      .eq('entry_price', signal.entry_price)
      .eq('stop_loss', signal.stop_loss)
      .eq('take_profit', signal.take_profit);
    if (sameError) throw new Error(`duplicate check failed: ${sameError.message}`);
    const rows = (same ?? []) as SetupRow[];
    const originalId = findOriginal(signal, rows);
    return rows.find((r) => r.id === originalId) ?? null;
  }

  /** Fetch the newest bars, then re-check until the bar that just completed arrives. */
  private async refreshToLatestBar(now: Date): Promise<void> {
    // Yesterday's bar; on a Sunday that is Friday's, as there is no Saturday bar.
    const daysBack = now.getUTCDay() === 0 ? 2 : 1;
    const expected = (Math.floor(now.getTime() / DAY_MS) - daysBack) * DAY_MS;
    for (let attempt = 1; attempt <= BAR_WAIT_ATTEMPTS; attempt++) {
      await this.data.refreshDaily();
      const bars = await this.data.goldDaily().catch((): DailyBar[] => []);
      if (bars.some((b) => Date.parse(b.ts) >= expected)) return;
      if (attempt < BAR_WAIT_ATTEMPTS) await this.wait(BAR_WAIT_MS);
    }
  }

  /** A failed read becomes an empty list, which a HARD agent reports as DATA_MISSING. */
  private async loadData(): Promise<AgentData> {
    const bars = (label: string, read: Promise<DailyBar[]>): Promise<DailyBar[]> =>
      read.catch(async (err) => {
        await this.events.warn(EVENT_SOURCE, `${label} unavailable`, { error: String(err) });
        return [];
      });
    const macro = (i: MacroInstrument) => bars(i, this.data.macroDaily(i));
    const cot = this.data.cotReports().catch(async (err): Promise<CotReport[]> => {
      await this.events.warn(EVENT_SOURCE, 'COT unavailable', { error: String(err) });
      return [];
    });
    const [goldDaily, eurUsd, usdJpy, note10y, note2y, reports] = await Promise.all([
      bars('XAU daily', this.data.goldDaily()),
      macro('EUR_USD'),
      macro('USD_JPY'),
      macro('USB10Y_USD'),
      macro('USB02Y_USD'),
      cot,
    ]);
    const { events, coverageEnd } = effectiveSchedule();
    return { goldDaily, eurUsd, usdJpy, note10y, note2y, cot: reports, schedule: events, calendarEnd: coverageEnd };
  }

  private async store(signalId: string, e: Evaluation, firedAt: string, fire: FirePrice | null): Promise<void> {
    if (!this.supabase) throw new Error('Supabase client not configured');
    const { error } = await this.supabase.from('signal_evaluations').insert({
      signal_id: signalId,
      ruleset_version: e.ruleset,
      eligible: e.eligible,
      agents: e.agents,
      evidence: e.evidence,
      duplicate_of: e.duplicateOf,
      fired_at: firedAt,
      fire_price: fire?.price ?? null,
      fire_price_source: fire?.source ?? null,
    });
    if (error) throw new Error(`signal_evaluations insert failed: ${error.message}`);
  }

  private async storeSummary(signalId: string, text: string, model: string): Promise<void> {
    const { error } = await this.supabase!.from('signal_evaluations').update({ ai_summary: text, ai_model: model }).eq('signal_id', signalId);
    if (error) await this.events.warn(EVENT_SOURCE, 'AI summary not stored', { signalId, error: error.message });
  }
}
