import { Module } from '@nestjs/common';
import { SupabaseModule } from '../supabase/supabase.module';
import { BrokerModule } from '../broker/broker.module';
import { AlertsService } from './alerts.service';
import { AlertsController } from './alerts.controller';

/**
 * AlertsModule: imports BrokerModule so AlertsService can check OANDA's live
 * 'tradeable' flag before firing the feed-stale heartbeat (suppresses the
 * ~1h daily OANDA demo break at ~21:00–22:00 UTC).
 */
@Module({
  imports: [SupabaseModule, BrokerModule],
  controllers: [AlertsController],
  providers: [AlertsService],
  exports: [AlertsService],
})
export class AlertsModule {}
