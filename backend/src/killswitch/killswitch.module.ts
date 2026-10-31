import { Module } from '@nestjs/common';
import { SupabaseModule } from '../supabase/supabase.module';
import { BrokerModule } from '../broker/broker.module';
import { AlertsModule } from '../alerts/alerts.module';
import { RiskModule } from '../risk/risk.module';
import { CircuitBreakerService } from './circuit-breaker.service';
import { DailyStatusService } from './daily-status.service';
import { TelegramCommandService } from './telegram-command.service';
import { WeeklyReportService } from '../alerts/weekly-report.service';
import { ForwardTestService } from '../v1/ledger/forward-test.service';
import { WeeklySnapshotService } from '../v1/ledger/weekly-snapshot.service';

/**
 * KillSwitchModule (Phase D, L2-INC-4): circuit breakers (§6) + Telegram command
 * control + weekly performance report. Uses the persistent TradingStateService
 * (from RiskModule). DEMO ONLY; no live-mode switch is exposed anywhere.
 */
@Module({
  imports: [SupabaseModule, BrokerModule, AlertsModule, RiskModule],
  providers: [CircuitBreakerService, DailyStatusService, TelegramCommandService, WeeklyReportService, ForwardTestService, WeeklySnapshotService],
  exports: [CircuitBreakerService],
})
export class KillSwitchModule {}
