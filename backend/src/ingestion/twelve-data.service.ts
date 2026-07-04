import { Injectable } from '@nestjs/common';
import { fetchJson } from './resilience';
import { RateBudgetService } from './rate-budget.service';
import { PROVIDER_TWELVE_DATA, SYMBOL, FX_PAIR, OUTPUT_SIZE, Timeframe } from './ingestion.constants';

export interface CandleRow {
  ts: string; // ISO timestamptz
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
}

export interface FxRow {
  rate: number;
  ts: string; // ISO timestamptz
}

interface TwelveDataTimeSeries {
  status?: string;
  code?: number;
  message?: string;
  values?: Array<{
    datetime: string;
    open: string;
    high: string;
    low: string;
    close: string;
    volume?: string;
  }>;
}

interface TwelveDataExchangeRate {
  status?: string;
  code?: number;
  message?: string;
  symbol?: string;
  rate?: number;
  timestamp?: number;
}

const BASE_URL = 'https://api.twelvedata.com';

/**
 * Twelve Data client. Each method performs ONE raw HTTP request (no internal
 * retry — the caller wraps it with withRetry). Every attempt increments the
 * rate-budget counter so the daily rollup reflects real usage.
 */
@Injectable()
export class TwelveDataService {
  constructor(private readonly rateBudget: RateBudgetService) {}

  private get apiKey(): string {
    return process.env.TWELVE_DATA_API_KEY ?? '';
  }

  /** Normalise a Twelve Data datetime string to an ISO UTC timestamp. */
  static parseTs(datetime: string): string {
    let s: string;
    if (datetime.includes(' ')) {
      s = datetime.replace(' ', 'T'); // "2024-01-01 09:30:00"
    } else if (datetime.length === 10) {
      s = `${datetime}T00:00:00`; // "2024-01-01" (1day interval)
    } else {
      s = datetime;
    }
    return new Date(`${s}Z`).toISOString();
  }

  async fetchTimeSeries(interval: Timeframe): Promise<CandleRow[]> {
    const params = new URLSearchParams({
      symbol: SYMBOL,
      interval,
      outputsize: String(OUTPUT_SIZE),
      apikey: this.apiKey,
    });
    this.rateBudget.increment(PROVIDER_TWELVE_DATA);
    const json = await fetchJson<TwelveDataTimeSeries>(`${BASE_URL}/time_series?${params}`);

    if (json.status === 'error' || !json.values) {
      throw new Error(`Twelve Data time_series error: ${json.message ?? 'no values'}`);
    }

    return json.values.map((v) => ({
      ts: TwelveDataService.parseTs(v.datetime),
      open: Number(v.open),
      high: Number(v.high),
      low: Number(v.low),
      close: Number(v.close),
      volume: v.volume != null && v.volume !== '' ? Number(v.volume) : null,
    }));
  }

  async fetchExchangeRate(): Promise<FxRow> {
    const params = new URLSearchParams({ symbol: FX_PAIR, apikey: this.apiKey });
    this.rateBudget.increment(PROVIDER_TWELVE_DATA);
    const json = await fetchJson<TwelveDataExchangeRate>(`${BASE_URL}/exchange_rate?${params}`);

    if (json.status === 'error' || json.rate == null) {
      throw new Error(`Twelve Data exchange_rate error: ${json.message ?? 'no rate'}`);
    }

    const ts = json.timestamp
      ? new Date(json.timestamp * 1000).toISOString()
      : new Date().toISOString();
    return { rate: json.rate, ts };
  }
}
