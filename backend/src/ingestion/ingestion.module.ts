import { Module } from '@nestjs/common';
import { SupabaseModule } from '../supabase/supabase.module';
import { CommonModule } from '../common/common.module';
import { IndicatorsModule } from '../indicators/indicators.module';
import { SignalsModule } from '../signals/signals.module';
import { IngestionService } from './ingestion.service';
import { IngestionController } from './ingestion.controller';
import { IngestionHealthController } from './ingestion.health.controller';
import { TwelveDataService } from './twelve-data.service';
import { GoldApiService } from './gold-api.service';
import { RateBudgetService } from './rate-budget.service';
import { CircuitBreakerRegistry } from './circuit-breaker';

@Module({
  imports: [SupabaseModule, CommonModule, IndicatorsModule, SignalsModule],
  controllers: [IngestionHealthController, IngestionController],
  providers: [
    IngestionService,
    TwelveDataService,
    GoldApiService,
    RateBudgetService,
    CircuitBreakerRegistry,
  ],
  exports: [IngestionService],
})
export class IngestionModule {}
