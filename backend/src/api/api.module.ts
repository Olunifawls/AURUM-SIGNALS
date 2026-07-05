import { Module } from '@nestjs/common';
import { SupabaseModule } from '../supabase/supabase.module';
import { IngestionModule } from '../ingestion/ingestion.module';
import { ReadController } from './read.controller';
import { ReadService } from './read.service';
import { HealthService } from './health.service';

/**
 * Public read REST API + formalized health endpoint. Imports IngestionModule
 * only to read live per-source circuit-breaker error counts for /api/health.
 */
@Module({
  imports: [SupabaseModule, IngestionModule],
  controllers: [ReadController],
  providers: [ReadService, HealthService],
})
export class ApiModule {}
