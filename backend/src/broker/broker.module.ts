import { Module } from '@nestjs/common';
import { SupabaseModule } from '../supabase/supabase.module';
import { BROKER_ADAPTER } from './broker.interface';
import { OandaAdapter } from './oanda.adapter';
import { OrderPlacementService } from './order-placement.service';

/**
 * BrokerModule (Phase A, L2-INC-1): the OANDA DEMO adapter behind IBrokerAdapter
 * + the idempotent place flow. No risk logic, no signal wiring, no live mode.
 */
@Module({
  imports: [SupabaseModule],
  providers: [
    OandaAdapter,
    { provide: BROKER_ADAPTER, useExisting: OandaAdapter },
    OrderPlacementService,
  ],
  exports: [BROKER_ADAPTER, OrderPlacementService],
})
export class BrokerModule {}
