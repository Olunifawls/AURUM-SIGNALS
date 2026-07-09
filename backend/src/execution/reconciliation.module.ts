import { Module } from '@nestjs/common';
import { SupabaseModule } from '../supabase/supabase.module';
import { BrokerModule } from '../broker/broker.module';
import { AlertsModule } from '../alerts/alerts.module';
import { KillSwitchModule } from '../killswitch/killswitch.module';
import { ReconciliationService } from './reconciliation.service';
import { ExecutionReadinessService } from './readiness.service';
import { BreakevenStopService } from './breakeven-stop.service';

/**
 * ReconciliationModule (Phase C): broker-as-source-of-truth sync + equity
 * snapshots + startup reconcile gate. Reads the broker; NEVER places/closes
 * (the broker initiates all closes — including manual closes via the API which
 * then mark the DB position closed directly).
 * BreakevenStopService runs on the same 5-min cadence and modifies the
 * broker-side SL when a trade reaches +1R (BREAKEVEN_STOP_ENABLED=true only).
 */
@Module({
  imports: [SupabaseModule, BrokerModule, AlertsModule, KillSwitchModule],
  providers: [ReconciliationService, ExecutionReadinessService, BreakevenStopService],
  exports: [ReconciliationService, ExecutionReadinessService],
})
export class ReconciliationModule {}
