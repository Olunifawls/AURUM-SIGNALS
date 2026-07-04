import { Module } from '@nestjs/common';
import { SupabaseModule } from '../supabase/supabase.module';
import { IngestionService } from './ingestion.service';
import { IngestionController } from './ingestion.controller';
import { IngestionHealthController } from './ingestion.health.controller';
import { TwelveDataService } from './twelve-data.service';
import { GoldApiService } from './gold-api.service';
import { SystemEventsService } from './system-events.service';
import { RateBudgetService } from './rate-budget.service';
import { CircuitBreakerRegistry } from './circuit-breaker';

@Module({
  imports: [SupabaseModule],
  controllers: [IngestionHealthController, IngestionController],
  providers: [
    IngestionService,
    TwelveDataService,
    GoldApiService,
    SystemEventsService,
    RateBudgetService,
    CircuitBreakerRegistry,
  ],
  exports: [IngestionService],
})
export class IngestionModule {}
