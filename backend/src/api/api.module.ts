import { Module } from '@nestjs/common';
import { SupabaseModule } from '../supabase/supabase.module';
import { IngestionModule } from '../ingestion/ingestion.module';
import { BrokerModule } from '../broker/broker.module';
import { RiskModule } from '../risk/risk.module';
import { ReadController } from './read.controller';
import { ReadService } from './read.service';
import { HealthService } from './health.service';
import { ExecutionReadController } from './execution-read.controller';
import { ExecutionReadService } from './execution-read.service';

/**
 * Public read REST API + formalized health endpoint. Imports IngestionModule
 * only to read live per-source circuit-breaker error counts for /api/health.
 * Also hosts the admin-guarded L2 Execution read API (BrokerModule for live P/L,
 * RiskModule for the persistent halt state).
 */
@Module({
  imports: [SupabaseModule, IngestionModule, BrokerModule, RiskModule],
  controllers: [ReadController, ExecutionReadController],
  providers: [ReadService, HealthService, ExecutionReadService],
})
export class ApiModule {}
