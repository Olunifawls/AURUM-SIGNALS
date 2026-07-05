import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { HealthModule } from './health/health.module';
import { SupabaseModule } from './supabase/supabase.module';
import { IngestionModule } from './ingestion/ingestion.module';
import { IndicatorsModule } from './indicators/indicators.module';
import { SignalsModule } from './signals/signals.module';
import { TrackerModule } from './tracker/tracker.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    HealthModule,
    SupabaseModule,
    IndicatorsModule,
    SignalsModule,
    TrackerModule,
    IngestionModule,
  ],
})
export class AppModule {}
