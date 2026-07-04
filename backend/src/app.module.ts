import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { HealthModule } from './health/health.module';
import { SupabaseModule } from './supabase/supabase.module';
import { IngestionModule } from './ingestion/ingestion.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    HealthModule,
    SupabaseModule,
    IngestionModule,
  ],
})
export class AppModule {}
