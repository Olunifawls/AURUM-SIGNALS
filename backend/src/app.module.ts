import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { HealthModule } from './health/health.module';
import { SupabaseModule } from './supabase/supabase.module';
import { IngestionModule } from './ingestion/ingestion.module';
import { IndicatorsModule } from './indicators/indicators.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    HealthModule,
    SupabaseModule,
    IndicatorsModule,
    IngestionModule,
  ],
})
export class AppModule {}
