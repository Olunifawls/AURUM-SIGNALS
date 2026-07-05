import { Module } from '@nestjs/common';
import { SupabaseModule } from '../supabase/supabase.module';
import { AlertsModule } from '../alerts/alerts.module';
import { SystemEventsService } from './system-events.service';

/**
 * Shared cross-cutting providers. SystemEventsService forwards ERROR-level
 * events to AlertsModule (throttled admin alerts), so CommonModule imports
 * AlertsModule. AlertsModule does NOT import CommonModule (it writes its own
 * WARN rows directly), so there is no dependency cycle.
 */
@Module({
  imports: [SupabaseModule, AlertsModule],
  providers: [SystemEventsService],
  exports: [SystemEventsService],
})
export class CommonModule {}
