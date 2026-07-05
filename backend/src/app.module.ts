import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { HealthModule } from './health/health.module';
import { SupabaseModule } from './supabase/supabase.module';
import { IngestionModule } from './ingestion/ingestion.module';
import { IndicatorsModule } from './indicators/indicators.module';
import { SignalsModule } from './signals/signals.module';
import { TrackerModule } from './tracker/tracker.module';
import { SizingModule } from './sizing/sizing.module';
import { AlertsModule } from './alerts/alerts.module';
import { ApiModule } from './api/api.module';
import { Level2Module } from './level2/level2.module';
import { BrokerModule } from './broker/broker.module';
import { RiskModule } from './risk/risk.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    HealthModule,
    SupabaseModule,
    AlertsModule,
    IndicatorsModule,
    SizingModule,
    SignalsModule,
    TrackerModule,
    IngestionModule,
    ApiModule,
    Level2Module,
    BrokerModule,
    RiskModule,
  ],
})
export class AppModule {}
