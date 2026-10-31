import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { SupabaseClient } from '@supabase/supabase-js';
import { LONDON } from '../common/timezone';
import { SUPABASE_CLIENT } from '../supabase/supabase.provider';
import { formatWeeklyHeadline } from '../v1/ledger/weekly-snapshot';
import { WeeklySnapshotService } from '../v1/ledger/weekly-snapshot.service';
import { AlertsService } from './alerts.service';

/**
 * Weekly report, sent to the owner's Telegram every Sunday 17:00 UK time. It writes
 * one weekly_snapshots row and sends that row's headline, so the report, /report and
 * a scheduled review of the table all show the same numbers.
 */
@Injectable()
export class WeeklyReportService {
  private readonly logger = new Logger('WeeklyReport');

  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient | null,
    private readonly alerts: AlertsService,
    private readonly snapshots: WeeklySnapshotService,
  ) {}

  @Cron('0 17 * * 0', { timeZone: LONDON })
  async scheduledReport(): Promise<void> {
    if (!this.supabase) return;
    try {
      const { payload } = await this.snapshots.write(new Date());
      await this.alerts.send(formatWeeklyHeadline(payload, 'Snapshot'));
      this.logger.log('weekly snapshot written and report sent');
    } catch (err) {
      this.logger.error(`weekly report failed: ${String(err)}`);
    }
  }

  /** The Telegram /report command: the latest snapshot, so it matches the last weekly
   * report. Before the first one, live numbers, labelled and not saved. */
  async buildReport(now: Date): Promise<string> {
    if (!this.supabase) return '(no database)';
    const latest = await this.snapshots.latest();
    if (latest) return formatWeeklyHeadline(latest.payload, 'Snapshot');
    return formatWeeklyHeadline(await this.snapshots.build(now), 'No snapshot yet, live numbers');
  }
}
