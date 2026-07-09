import { Module } from '@nestjs/common';
import { SupabaseModule } from '../supabase/supabase.module';
import { BrokerModule } from '../broker/broker.module';
import { AlertsModule } from '../alerts/alerts.module';
import { RiskModule } from '../risk/risk.module';
import { CircuitBreakerService } from './circuit-breaker.service';
import { TelegramCommandService } from './telegram-command.service';
import { WeeklyReportService } from '../alerts/weekly-report.service';

/**
 * KillSwitchModule (Phase D, L2-INC-4): circuit breakers (§6) + Telegram command
 * control + weekly performance report. Uses the persistent TradingStateService
 * (from RiskModule). DEMO ONLY; no live-mode switch is exposed anywhere.
 */
@Module({
  imports: [SupabaseModule, BrokerModule, AlertsModule, RiskModule],
  providers: [CircuitBreakerService, TelegramCommandService, WeeklyReportService],
  exports: [CircuitBreakerService],
})
export class KillSwitchModule {}
