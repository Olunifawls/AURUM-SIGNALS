import { Module } from '@nestjs/common';
import { SupabaseModule } from '../supabase/supabase.module';
import { AlertsService } from './alerts.service';
import { AlertsController } from './alerts.controller';

/**
 * AlertsModule imports only SupabaseModule (it writes its own WARN rows directly
 * to avoid a DI cycle with CommonModule/SystemEventsService, which forwards
 * ERROR events here).
 */
@Module({
  imports: [SupabaseModule],
  controllers: [AlertsController],
  providers: [AlertsService],
  exports: [AlertsService],
})
export class AlertsModule {}
