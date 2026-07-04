import { Module } from '@nestjs/common';
import { HealthModule } from './health/health.module';
import { SupabaseModule } from './supabase/supabase.module';

@Module({
  imports: [HealthModule, SupabaseModule],
})
export class AppModule {}
