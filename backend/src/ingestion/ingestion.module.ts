import { Module } from '@nestjs/common';
import { SupabaseModule } from '../supabase/supabase.module';
import { CommonModule } from '../common/common.module';
import { IndicatorsModule } from '../indicators/indicators.module';
import { SignalsModule } from '../signals/signals.module';
import { TrackerModule } from '../tracker/tracker.module';
import { IngestionService } from './ingestion.service';
import { IngestionController } from './ingestion.controller';
import { OandaCandlesService } from './oanda-candles.service';
import { RateBudgetService } from './rate-budget.service';
import { CircuitBreakerRegistry } from './circuit-breaker';

// FIX-1: candle/FX source is now OANDA; the Twelve Data + GoldAPI providers are retired.
@Module({
  imports: [SupabaseModule, CommonModule, IndicatorsModule, SignalsModule, TrackerModule],
  controllers: [IngestionController],
  providers: [IngestionService, OandaCandlesService, RateBudgetService, CircuitBreakerRegistry],
  exports: [IngestionService],
})
export class IngestionModule {}
