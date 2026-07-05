import { Module } from '@nestjs/common';
import { SupabaseModule } from '../supabase/supabase.module';
import { BrokerModule } from '../broker/broker.module';
import { RiskManagerService } from './risk-manager.service';
import { TradingStateService } from './trading-state.service';

/**
 * RiskManagerModule (Phase B, L2-INC-2): pre-trade checklist + sizing. Approve/
 * reject + compute size only — NO order placement (INC-3), NO halt state machine
 * / volatility trigger / Telegram (INC-4), NO live mode.
 */
@Module({
  imports: [SupabaseModule, BrokerModule],
  providers: [RiskManagerService, TradingStateService],
  exports: [RiskManagerService, TradingStateService],
})
export class RiskModule {}
