import { Injectable } from '@nestjs/common';
import {
  estimateDailyTwelveDataCalls,
  estimateGatedDailyTwelveDataCalls,
  TWELVE_DATA_DAILY_LIMIT,
} from './ingestion.constants';

/**
 * In-memory daily API-call counter, per provider. Counts reset when the UTC
 * day rolls over. This is process-local (sufficient for a single-instance
 * personal deployment); it is not persisted across restarts.
 */
@Injectable()
export class RateBudgetService {
  private counts = new Map<string, number>();
  private dayKey = RateBudgetService.utcDayKey();

  private static utcDayKey(now: Date = new Date()): string {
    return now.toISOString().slice(0, 10); // YYYY-MM-DD
  }

  private rollIfNewDay(): void {
    const today = RateBudgetService.utcDayKey();
    if (today !== this.dayKey) {
      this.dayKey = today;
      this.counts.clear();
    }
  }

  increment(provider: string, n = 1): void {
    this.rollIfNewDay();
    this.counts.set(provider, (this.counts.get(provider) ?? 0) + n);
  }

  get(provider: string): number {
    this.rollIfNewDay();
    return this.counts.get(provider) ?? 0;
  }

  snapshot(): {
    day: string;
    counts: Record<string, number>;
    estimateNominalPerDay: number;
    estimateGatedPerDay: number;
    dailyLimit: number;
  } {
    this.rollIfNewDay();
    return {
      day: this.dayKey,
      counts: Object.fromEntries(this.counts),
      estimateNominalPerDay: estimateDailyTwelveDataCalls(),
      estimateGatedPerDay: estimateGatedDailyTwelveDataCalls(),
      dailyLimit: TWELVE_DATA_DAILY_LIMIT,
    };
  }
}
