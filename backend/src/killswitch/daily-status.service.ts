import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../supabase/supabase.provider';
import { AlertsService } from '../alerts/alerts.service';
import { formatDailyStatus } from '../alerts/alert-format';
import { TradingStateService } from '../risk/trading-state.service';
import { calendarExpiryWarning, effectiveSchedule } from '../v1/calendar/economic-calendar';
import { scrubString } from './scrub';

const NO_TRADE_ALERT_DAYS = 7;

/**
 * Daily Telegram reminder while the system is not trading: sent whenever any halt
 * is active or no trade has been placed in 7 days, so a stuck system cannot go
 * unnoticed once its one-off halt alert has scrolled away. A calendar about to run
 * out sends it too, or a healthy system would never show the warning. Quiet otherwise.
 */
@Injectable()
export class DailyStatusService {
  private readonly logger = new Logger('DailyStatus');

  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient | null,
    private readonly state: TradingStateService,
    private readonly alerts: AlertsService,
  ) {}

  @Cron('0 8 * * *')
  async sendDailyStatus(now: Date = new Date()): Promise<void> {
    if (!this.supabase) return;
    try {
      const halts = await this.state.getActiveHalts(now);
      const { data, error } = await this.supabase
        .from('positions')
        .select('opened_at')
        .order('opened_at', { ascending: false })
        .limit(1);
      if (error) throw new Error(`last trade query failed: ${error.message}`);

      const lastTrade = data?.[0]?.opened_at as string | undefined;
      const daysSinceLastTrade = lastTrade
        ? Math.floor((now.getTime() - new Date(lastTrade).getTime()) / 86400_000)
        : null;
      const noRecentTrade = daysSinceLastTrade === null || daysSinceLastTrade >= NO_TRADE_ALERT_DAYS;
      const calendarWarning = calendarExpiryWarning(effectiveSchedule().events, now);
      if (!halts.length && !noRecentTrade && !calendarWarning) return;

      await this.alerts.send(
        formatDailyStatus({
          halts: halts.map((h) => ({ haltType: h.halt_type, reason: h.reason && scrubString(h.reason) })),
          daysSinceLastTrade,
          calendarWarning,
        }),
      );
    } catch (err) {
      this.logger.error(scrubString(`daily status failed: ${String(err)}`));
    }
  }
}
