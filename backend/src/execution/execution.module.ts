import { Module } from '@nestjs/common';
import { SupabaseModule } from '../supabase/supabase.module';
import { BrokerModule } from '../broker/broker.module';
import { RiskModule } from '../risk/risk.module';
import { ReconciliationModule } from './reconciliation.module';
import { ExecutionService } from './execution.service';

/**
 * ExecutionModule (Phase C): places approved CORE signals on demo. Gated on the
 * startup reconcile (via ReconciliationModule's readiness) and AUTO_TRADE_ENABLED.
 * DEMO ONLY. Never executes the experimental 15min track.
 */
@Module({
  imports: [SupabaseModule, BrokerModule, RiskModule, ReconciliationModule],
  providers: [ExecutionService],
  exports: [ExecutionService],
})
export class ExecutionModule {}
