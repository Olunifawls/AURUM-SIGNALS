import { Injectable } from '@nestjs/common';
import { fetchJson } from './resilience';
import { Timeframe } from './ingestion.constants';

/** One OHLC candle row (ISO ts, numeric OHLCV). */
export interface CandleRow {
  ts: string; // ISO timestamptz (candle start, UTC)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
}

const OANDA_URL = 'https://api-fxpractice.oanda.com';
const XAU = 'XAU_USD';
const GBP_USD = 'GBP_USD';

// our timeframe -> OANDA granularity
const GRANULARITY: Record<Timeframe, string> = {
  '15min': 'M15',
  '1h': 'H1',
  '4h': 'H4',
  '1day': 'D',
};

/**
 * FIX-1: candles + FX from the OANDA practice API — the SAME feed we execute on,
 * so signal data == execution data. MID OHLC, COMPLETE bars only, UTC-aligned
 * (H4 -> 00/04/08/12/16/20, D -> 00:00), junk/future bars rejected. This replaces
 * the Twelve Data + GoldAPI dual-source path.
 */
@Injectable()
export class OandaCandlesService {
  private get token(): string {
    return process.env.OANDA_API_TOKEN_DEMO || '';
  }

  private async rawCandles(instrument: string, granularity: string, count: number): Promise<any[]> {
    // alignmentTimezone=UTC + dailyAlignment=0 => H4 aligns to 00/04/08/12/16/20 UTC, D to 00:00 UTC.
    const url =
      `${OANDA_URL}/v3/instruments/${instrument}/candles` +
      `?price=M&granularity=${granularity}&count=${count}&alignmentTimezone=UTC&dailyAlignment=0`;
    const json = await fetchJson<{ candles?: any[] }>(url, {
      headers: { Authorization: `Bearer ${this.token}`, 'Accept-Datetime-Format': 'RFC3339' },
    });
    return json.candles ?? [];
  }

  /**
   * COMPLETE XAU/USD candles for a timeframe, mid OHLC. The still-forming latest
   * bar is dropped (never stored), so stored bars are final. Junk rejected:
   * future-dated (> now+1min), non-finite / non-positive OHLC.
   */
  async fetchCandles(tf: Timeframe, count = 400): Promise<CandleRow[]> {
    const raw = await this.rawCandles(XAU, GRANULARITY[tf], count);
    const cutoff = Date.now() + 60_000;
    const out: CandleRow[] = [];
    for (const c of raw) {
      if (c?.complete !== true) continue; // only closed bars are stored
      const tsMs = Date.parse(c.time);
      if (!Number.isFinite(tsMs) || tsMs > cutoff) continue; // reject junk / future
      const o = Number(c.mid?.o);
      const h = Number(c.mid?.h);
      const l = Number(c.mid?.l);
      const cl = Number(c.mid?.c);
      if (![o, h, l, cl].every((v) => Number.isFinite(v) && v > 0)) continue; // reject bad OHLC
      out.push({ ts: new Date(tsMs).toISOString(), open: o, high: h, low: l, close: cl, volume: Number(c.volume ?? 0) });
    }
    return out;
  }

  /** GBP/USD rate from the latest COMPLETE OANDA M15 mid close (single source). */
  async fetchFx(): Promise<{ rate: number; ts: string }> {
    const raw = await this.rawCandles(GBP_USD, 'M15', 3);
    const complete = raw.filter((c) => c?.complete === true);
    const last = complete[complete.length - 1];
    const rate = Number(last?.mid?.c);
    if (!last || !Number.isFinite(rate) || rate <= 0) throw new Error('no complete GBP_USD candle from OANDA');
    return { rate, ts: new Date(Date.parse(last.time)).toISOString() };
  }
}
