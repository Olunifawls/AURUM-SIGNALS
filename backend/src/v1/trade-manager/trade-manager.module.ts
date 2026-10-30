import { Module } from '@nestjs/common';
import { SupabaseModule } from '../../supabase/supabase.module';
import { CommonModule } from '../../common/common.module';
import { AlertsModule } from '../../alerts/alerts.module';
import { BrokerModule } from '../../broker/broker.module';
import { V1Module } from '../v1.module';
import { NewsExitService } from './news-exit.service';
import { ShadowWatchService } from './shadow-watch.service';

@Module({
  imports: [SupabaseModule, CommonModule, AlertsModule, BrokerModule, V1Module],
  providers: [NewsExitService, ShadowWatchService],
})
export class TradeManagerModule {}
