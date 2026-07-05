import { Module } from '@nestjs/common';
import { SupabaseModule } from '../supabase/supabase.module';
import { BrokerModule } from '../broker/broker.module';
import { AlertsModule } from '../alerts/alerts.module';
import { KillSwitchModule } from '../killswitch/killswitch.module';
import { ReconciliationService } from './reconciliation.service';
import { ExecutionReadinessService } from './readiness.service';

/**
 * ReconciliationModule (Phase C): broker-as-source-of-truth sync + equity
 * snapshots + startup reconcile gate. Reads the broker; NEVER places/closes.
 */
@Module({
  imports: [SupabaseModule, BrokerModule, AlertsModule, KillSwitchModule],
  providers: [ReconciliationService, ExecutionReadinessService],
  exports: [ReconciliationService, ExecutionReadinessService],
})
export class ReconciliationModule {}
