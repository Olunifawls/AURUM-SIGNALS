import { Injectable } from '@nestjs/common';
import { fetchJson } from './resilience';
import { RateBudgetService } from './rate-budget.service';
import { PROVIDER_GOLD_API } from './ingestion.constants';

interface GoldApiResponse {
  price?: number;
  currency?: string;
  metal?: string;
  timestamp?: number;
}

const GOLD_API_URL = 'https://www.goldapi.io/api/XAU/USD';

/**
 * GoldAPI client — used only as a liveness fallback when Twelve Data is down.
 * Returns the current XAU/USD spot price; we do NOT build candles from it.
 */
@Injectable()
export class GoldApiService {
  constructor(private readonly rateBudget: RateBudgetService) {}

  async fetchSpot(): Promise<number> {
    this.rateBudget.increment(PROVIDER_GOLD_API);
    const json = await fetchJson<GoldApiResponse>(GOLD_API_URL, {
      headers: {
        'x-access-token': process.env.GOLDAPI_KEY ?? '',
        'Content-Type': 'application/json',
      },
    });
    if (json.price == null) {
      throw new Error('GoldAPI returned no price');
    }
    return json.price;
  }
}
