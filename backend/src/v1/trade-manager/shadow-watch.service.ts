import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../supabase/supabase.provider';
import { SystemEventsService } from '../../common/system-events.service';
import { SYMBOL } from '../../ingestion/ingestion.constants';
import { OandaCandlesService } from '../../ingestion/oanda-candles.service';
import { completeBars } from '../agents/bars';
import { dollarAgent } from '../agents/macro.agent';
import { regimeAgent } from '../agents/regime.agent';
import { AgentResult, DailyBar, Direction } from '../agents/types';
import { V1DataService } from '../data/v1-data.service';
import { dollarShock } from './dollar-shock';

const EVENT_SOURCE = 'shadow-watch';
const HOURLY_BARS = 30;

interface OpenPosition {
  id: string;
  signal_id: string | null;
  side: Direction;
  opened_at: string;
}

/**
 * SHADOW checks on open trades. Log only: this service has no broker and writes only
 * trade_watch_events, so it cannot open, close or change anything.
 */
@Injectable()
export class ShadowWatchService {
  private readonly logger = new Logger('ShadowWatch');

  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient | null,
    private readonly data: V1DataService,
    private readonly oanda: OandaCandlesService,
    private readonly events: SystemEventsService,
  ) {}

  private async openPositions(): Promise<OpenPosition[]> {
    if (!this.supabase) return [];
    const { data, error } = await this.supabase.from('positions').select('id,signal_id,side,opened_at').eq('status', 'OPEN');
    if (error) throw new Error(`positions query failed: ${error.message}`);
    return (data ?? []) as OpenPosition[];
  }

  private async latestPrice(): Promise<number | null> {
    const { data } = await this.supabase!
      .from('candles')
      .select('close')
      .eq('symbol', SYMBOL)
      .eq('timeframe', '15min')
      .order('ts', { ascending: false })
      .limit(1);
    return data?.length ? Number(data[0].close) : null;
  }

  /** Runs after the 00:05 data refresh. The unique key makes a repeat bar a no-op. */
  @Cron('10 0 * * *')
  async thesisWatch(now: Date = new Date()): Promise<void> {
    try {
      const positions = await this.openPositions();
      if (positions.length === 0) return;
      const [gold, eur, jpy] = await Promise.all([this.data.goldDaily(), this.data.macroDaily('EUR_USD'), this.data.macroDaily('USD_JPY')]);
      const complete = completeBars(gold, now);
      const bar = complete[complete.length - 1];
      if (!bar) return;
      const price = await this.latestPrice();
      for (const pos of positions) await this.checkThesis(pos, bar, gold, eur, jpy, price, now);
    } catch (err) {
      await this.events.warn(EVENT_SOURCE, 'thesis watch failed', { error: String(err) });
    }
  }

  private async checkThesis(
    pos: OpenPosition,
    bar: DailyBar,
    gold: DailyBar[],
    eur: DailyBar[],
    jpy: DailyBar[],
    price: number | null,
    now: Date,
  ): Promise<void> {
    const results: AgentResult[] = [regimeAgent(pos.side, gold, now), dollarAgent(pos.side, eur, jpy, now)];
    for (const r of results) {
      if (r.verdict === 'DATA_MISSING') continue; // no reading, so nothing has flipped
      const previous = await this.previousVerdict(pos.id, r.agent, bar.ts);
      if (previous === undefined) continue; // this bar is already recorded
      const flipped = r.verdict === 'FAIL' && previous !== 'FAIL';
      await this.record({ kind: 'THESIS_CHECK', position_id: pos.id, signal_id: pos.signal_id, agent: r.agent, verdict: r.verdict, flipped, bar_ts: bar.ts, price, detail: { reasons: r.reasons } });
      if (flipped) this.logger.warn(`thesis flip on ${pos.id}: ${r.agent} FAIL at ${price} (shadow, no action)`);
    }
  }

  /** The agent's last recorded verdict; PASS if none, as the trade passed at entry.
   * undefined when this bar has already been checked. */
  private async previousVerdict(positionId: string, agent: string, barTs: string): Promise<string | undefined> {
    const { data, error } = await this.supabase!
      .from('trade_watch_events')
      .select('verdict,bar_ts')
      .eq('position_id', positionId)
      .eq('kind', 'THESIS_CHECK')
      .eq('agent', agent)
      .order('bar_ts', { ascending: false })
      .limit(1);
    if (error) throw new Error(`trade_watch_events query failed: ${error.message}`);
    const last = data?.[0];
    if (!last) return 'PASS';
    return Date.parse(last.bar_ts as string) >= Date.parse(barTs) ? undefined : (last.verdict as string);
  }

  /** Hourly, once the previous hour's candles are complete. */
  @Cron('2 * * * *')
  async dollarShockWatch(): Promise<void> {
    try {
      const positions = await this.openPositions();
      if (positions.length === 0) return;
      const [eur, jpy] = await Promise.all([
        this.oanda.fetchInstrument('EUR_USD', 'H1', { count: HOURLY_BARS }),
        this.oanda.fetchInstrument('USD_JPY', 'H1', { count: HOURLY_BARS }),
      ]);
      const price = await this.latestPrice();
      for (const pos of positions) {
        const s = dollarShock(pos.side, eur, jpy);
        if (!s?.shock || Date.parse(s.barTs) < Date.parse(pos.opened_at)) continue; // the hour must fall inside the trade
        await this.record({ kind: 'DOLLAR_SHOCK', position_id: pos.id, signal_id: pos.signal_id, agent: 'dollar', verdict: null, flipped: false, bar_ts: s.barTs, price, detail: { move: s.move, averageRange: s.averageRange } });
        this.logger.warn(`dollar shock on ${pos.id} at ${price} (shadow, no action)`);
      }
    } catch (err) {
      await this.events.warn(EVENT_SOURCE, 'dollar shock watch failed', { error: String(err) });
    }
  }

  private async record(row: Record<string, unknown>): Promise<void> {
    const { error } = await this.supabase!.from('trade_watch_events').upsert(row, { onConflict: 'position_id,kind,agent,bar_ts', ignoreDuplicates: true });
    if (error) throw new Error(`trade_watch_events insert failed: ${error.message}`);
  }
}
