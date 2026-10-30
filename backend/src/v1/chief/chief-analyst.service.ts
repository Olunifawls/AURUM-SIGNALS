import { Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../supabase/supabase.provider';
import { SystemEventsService } from '../../common/system-events.service';
import { CotReport, DailyBar } from '../agents/types';
import { effectiveSchedule } from '../calendar/economic-calendar';
import { MacroInstrument, V1DataService } from '../data/v1-data.service';
import { DAY_MS } from '../v1.constants';
import { AiSummaryService } from './ai-summary.service';
import { AgentData, Evaluation, evaluateSignal, SignalToEvaluate } from './chief-analyst';

const EVENT_SOURCE = 'chief-analyst';
/** OANDA can flag the daily bar complete a few seconds after 00:00 UTC, when a 4h
 * signal may also fire. Wait this long for it rather than judge on a bar-old view. */
const BAR_WAIT_ATTEMPTS = 3;
const BAR_WAIT_MS = 5_000;

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
  ) {}

  protected wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async evaluate(signalId: string, signal: SignalToEvaluate, now: () => Date = () => new Date()): Promise<StoredEvaluation> {
    await this.refreshToLatestBar(now());
    const evaluation = evaluateSignal(signal, await this.loadData(), now());
    await this.store(signalId, evaluation);

    const summary = await this.ai.summarise(evaluation.evidence);
    if (summary) await this.storeSummary(signalId, summary.text, summary.model);
    return { ...evaluation, aiSummary: summary?.text ?? null };
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

  private async store(signalId: string, e: Evaluation): Promise<void> {
    if (!this.supabase) throw new Error('Supabase client not configured');
    const { error } = await this.supabase.from('signal_evaluations').insert({
      signal_id: signalId,
      ruleset_version: e.ruleset,
      eligible: e.eligible,
      agents: e.agents,
      evidence: e.evidence,
    });
    if (error) throw new Error(`signal_evaluations insert failed: ${error.message}`);
  }

  private async storeSummary(signalId: string, text: string, model: string): Promise<void> {
    const { error } = await this.supabase!.from('signal_evaluations').update({ ai_summary: text, ai_model: model }).eq('signal_id', signalId);
    if (error) await this.events.warn(EVENT_SOURCE, 'AI summary not stored', { signalId, error: error.message });
  }
}
