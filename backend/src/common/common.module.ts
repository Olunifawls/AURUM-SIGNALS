import { Module } from '@nestjs/common';
import { SupabaseModule } from '../supabase/supabase.module';
import { SystemEventsService } from './system-events.service';

/**
 * Shared cross-cutting providers. Currently just the system_events logger,
 * used by both the ingestion and indicator modules.
 */
@Module({
  imports: [SupabaseModule],
  providers: [SystemEventsService],
  exports: [SystemEventsService],
})
export class CommonModule {}
