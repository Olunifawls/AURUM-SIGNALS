import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../supabase/supabase.provider';
import { SystemEventsService } from '../../common/system-events.service';
import { SYMBOL } from '../../ingestion/ingestion.constants';
import { CandleRow, OandaCandlesService } from '../../ingestion/oanda-candles.service';
import { fetchJson } from '../../ingestion/resilience';
import { CotReport, DailyBar } from '../agents/types';
import { BACKFILL_FROM } from '../v1.constants';
import { effectiveSchedule } from '../calendar/economic-calendar';

export const MACRO_INSTRUMENTS = ['EUR_USD', 'USD_JPY', 'USB10Y_USD', 'USB02Y_USD'] as const;
export type MacroInstrument = (typeof MACRO_INSTRUMENTS)[number];

const EVENT_SOURCE = 'v1-data';
const XAU = 'XAU_USD';
const REFRESH_BARS = 10;
const BACKFILL_BARS = 1000;
/** Enough rows for 60 complete bars once the forming bar and weekends drop out. */
const READ_DAILY_BARS = 80;
const READ_COT_REPORTS = 60;

const COT_URL = 'https://publicreporting.cftc.gov/resource/72hh-3qpy.json';
const COT_MARKET_CODE = '088691';
const COT_TIMEOUT_MS = 30_000;

/** A CFTC row as the Socrata API returns it: everything is a string. */
interface CotApiRow {
  report_date_as_yyyy_mm_dd: string;
  m_money_positions_long_all: string;
  m_money_positions_short_all: string;
}

/** Parses CFTC rows, dropping any without finite positions. */
export function parseCotRows(rows: CotApiRow[]): CotReport[] {
  return rows
    .map((r) => ({
      reportDate: String(r.report_date_as_yyyy_mm_dd).slice(0, 10),
      managedMoneyLong: Number(r.m_money_positions_long_all),
      managedMoneyShort: Number(r.m_money_positions_short_all),
    }))
    .filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.reportDate) && Number.isFinite(r.managedMoneyLong) && Number.isFinite(r.managedMoneyShort));
}

/**
 * V1 data layer: daily macro candles and gold COT, written once and never updated.
 * Unlike the L1 candle crons it does not stop for the weekend, so Friday's and
 * Sunday's daily bars are stored as soon as they complete.
 */
@Injectable()
export class V1DataService implements OnModuleInit {
  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient | null,
    private readonly oanda: OandaCandlesService,
    private readonly events: SystemEventsService,
  ) {}

  private get configured(): boolean {
    return !!this.supabase && !!process.env.OANDA_API_TOKEN_DEMO;
  }

  onModuleInit(): void {
    if (!this.configured) return;
    for (const d of effectiveSchedule().disagreements) {
      void this.events.warn(EVENT_SOURCE, `calendar: ${d.name} differs between sources, using ${d.usedAt}`, { ...d });
    }
    void this.backfill();
  }

  /** Startup: everything from BACKFILL_FROM. Write-once, so a restart is harmless. */
  async backfill(): Promise<void> {
    const from = `${BACKFILL_FROM}T00:00:00Z`;
    for (const instrument of MACRO_INSTRUMENTS) {
      await this.isolated(`${instrument} backfill`, async () => {
        await this.storeMacro(instrument, await this.oanda.fetchInstrument(instrument, 'D', { count: BACKFILL_BARS, from }));
      });
    }
    await this.refreshCot();
  }

  @Cron('5 0 * * *')
  async dailyCron(): Promise<void> {
    if (this.configured) await this.refreshDaily();
  }

  /** CFTC publishes Friday afternoon, later after a holiday. Every 6h catches both. */
  @Cron('30 */6 * * *')
  async cotCron(): Promise<void> {
    if (this.configured) await this.refreshCot();
  }

  /** Latest daily bars for gold and the macro set. Each instrument is isolated. */
  async refreshDaily(): Promise<void> {
    await this.isolated('XAU refresh', async () => {
      await this.storeGold(await this.oanda.fetchInstrument(XAU, 'D', { count: REFRESH_BARS }));
    });
    for (const instrument of MACRO_INSTRUMENTS) {
      await this.isolated(`${instrument} refresh`, async () => {
        await this.storeMacro(instrument, await this.oanda.fetchInstrument(instrument, 'D', { count: REFRESH_BARS }));
      });
    }
  }

  async refreshCot(): Promise<void> {
    await this.isolated('COT refresh', async () => {
      const where = `cftc_contract_market_code='${COT_MARKET_CODE}' AND report_date_as_yyyy_mm_dd >= '${BACKFILL_FROM}T00:00:00.000'`;
      const url =
        `${COT_URL}?$where=${encodeURIComponent(where)}&$order=report_date_as_yyyy_mm_dd&$limit=1000` +
        '&$select=report_date_as_yyyy_mm_dd,m_money_positions_long_all,m_money_positions_short_all';
      const reports = parseCotRows(await fetchJson<CotApiRow[]>(url, {}, COT_TIMEOUT_MS));
      if (reports.length === 0) return;
      const rows = reports.map((r) => ({
        report_date: r.reportDate,
        managed_money_long: r.managedMoneyLong,
        managed_money_short: r.managedMoneyShort,
      }));
      const { error } = await this.supabase!.from('cot_reports').upsert(rows, { onConflict: 'report_date', ignoreDuplicates: true });
      if (error) throw new Error(`cot_reports insert failed: ${error.message}`);
    });
  }

  // ------------------------------------------------------------------ reads
  /** Reads throw on a query error: the chief analyst treats that as missing data. */
  async goldDaily(): Promise<DailyBar[]> {
    const { data, error } = await this.supabase!
      .from('candles')
      .select('ts,close')
      .eq('symbol', SYMBOL)
      .eq('timeframe', '1day')
      .order('ts', { ascending: false })
      .limit(READ_DAILY_BARS);
    if (error) throw new Error(`gold daily query failed: ${error.message}`);
    return (data ?? []).map((r) => ({ ts: r.ts as string, close: Number(r.close) }));
  }

  async macroDaily(instrument: MacroInstrument): Promise<DailyBar[]> {
    const { data, error } = await this.supabase!
      .from('macro_candles')
      .select('ts,close')
      .eq('instrument', instrument)
      .order('ts', { ascending: false })
      .limit(READ_DAILY_BARS);
    if (error) throw new Error(`${instrument} query failed: ${error.message}`);
    return (data ?? []).map((r) => ({ ts: r.ts as string, close: Number(r.close) }));
  }

  async cotReports(): Promise<CotReport[]> {
    const { data, error } = await this.supabase!
      .from('cot_reports')
      .select('report_date,managed_money_long,managed_money_short')
      .order('report_date', { ascending: false })
      .limit(READ_COT_REPORTS);
    if (error) throw new Error(`cot_reports query failed: ${error.message}`);
    return (data ?? []).map((r) => ({
      reportDate: r.report_date as string,
      managedMoneyLong: Number(r.managed_money_long),
      managedMoneyShort: Number(r.managed_money_short),
    }));
  }

  // ----------------------------------------------------------------- writes
  private async storeMacro(instrument: MacroInstrument, candles: CandleRow[]): Promise<void> {
    if (candles.length === 0) return;
    const rows = candles.map((c) => ({ instrument, ts: c.ts, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume }));
    const { error } = await this.supabase!.from('macro_candles').upsert(rows, { onConflict: 'instrument,ts', ignoreDuplicates: true });
    if (error) throw new Error(`macro_candles insert failed: ${error.message}`);
  }

  /** Same write-once insert as ingestion: a stored gold bar is never overwritten. */
  private async storeGold(candles: CandleRow[]): Promise<void> {
    if (candles.length === 0) return;
    const rows = candles.map((c) => ({ symbol: SYMBOL, timeframe: '1day', ts: c.ts, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume }));
    const { error } = await this.supabase!.from('candles').upsert(rows, { onConflict: 'symbol,timeframe,ts', ignoreDuplicates: true });
    if (error) throw new Error(`candles insert failed: ${error.message}`);
  }

  private async isolated(step: string, fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (err) {
      await this.events.warn(EVENT_SOURCE, `${step} failed`, { step, error: String(err) });
    }
  }
}
