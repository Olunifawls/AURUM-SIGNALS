import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../supabase/supabase.provider';
import { BROKER_ADAPTER, IBrokerAdapter } from '../broker/broker.interface';
import { SYMBOL } from '../ingestion/ingestion.constants';
import { isGoldMarketOpen, isMarketTradeableNow } from '../ingestion/market-hours';
import { Throttle, ADMIN_THROTTLE_MS } from './throttle';
import {
  AlertResolution,
  AlertSignal,
  HEARTBEAT_MESSAGE,
  SAMPLE_ALERT_SIGNAL,
  formatAdminError,
  formatNewSignal,
  formatResolution,
  isFeedStale,
  shouldAlertSignal,
} from './alert-format';

const EVENT_SOURCE = 'alerts';

/**
 * Telegram alerts. Every public method is isolated — a Telegram outage logs a
 * WARN to system_events and returns; it never throws into the caller
 * (ingestion / signals / tracker).
 */
@Injectable()
export class AlertsService {
  private readonly logger = new Logger('Alerts');
  private readonly adminThrottle = new Throttle(ADMIN_THROTTLE_MS);
  private readonly heartbeatThrottle = new Throttle(ADMIN_THROTTLE_MS);

  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient | null,
    @Inject(BROKER_ADAPTER) private readonly broker: IBrokerAdapter,
  ) {}

  private get token(): string | undefined {
    return process.env.TELEGRAM_BOT_TOKEN || undefined;
  }
  private get chatId(): string | undefined {
    return process.env.TELEGRAM_CHAT_ID || undefined;
  }
  private get alert15mEnabled(): boolean {
    return (process.env.ALERT_15MIN ?? 'false').toLowerCase() === 'true';
  }

  /** Low-level send. Returns true on success; never throws. */
  async send(text: string): Promise<boolean> {
    const token = this.token;
    const chatId = this.chatId;
    if (!token || !chatId) {
      await this.warnDb('Telegram not configured (missing TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID)');
      return false;
    }
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status} ${body.slice(0, 200)}`);
      }
      return true;
    } catch (err) {
      await this.warnDb(`Telegram send failed: ${String(err)}`);
      return false;
    }
  }

  async sendNewSignal(sig: AlertSignal): Promise<boolean> {
    if (!shouldAlertSignal(sig.track, this.alert15mEnabled)) {
      this.logger.log(`skipping alert for ${sig.track} ${sig.timeframe} signal (ALERT_15MIN off)`);
      return false;
    }
    return this.send(formatNewSignal(sig));
  }

  async sendResolution(res: AlertResolution): Promise<boolean> {
    // Same experimental gate as new-signal alerts: when ALERT_15MIN is off, an
    // experimental (15min) signal sends NEITHER open nor close alert. Core always alerts.
    if (!shouldAlertSignal(res.track, this.alert15mEnabled)) {
      this.logger.log(`skipping resolution alert for ${res.track} ${res.timeframe} (ALERT_15MIN off)`);
      return false;
    }
    return this.send(formatResolution(res));
  }

  /** Admin error alert — throttled to max 1 per source per 30 min. */
  async sendAdminError(source: string, message: string): Promise<boolean> {
    if (!this.adminThrottle.allow(source)) return false;
    return this.send(formatAdminError(source, message));
  }

  async sendTest(type: 'signal' | 'resolution' | 'admin' = 'signal'): Promise<{ sent: boolean; text: string }> {
    let text: string;
    if (type === 'resolution') {
      text = formatResolution({ status: 'HIT_TP', direction: 'BUY', timeframe: '4h', entry: 2341.2, rMultiple: 2.0, track: 'core' });
    } else if (type === 'admin') {
      text = formatAdminError('test', 'This is a test admin/error alert.');
    } else {
      text = formatNewSignal(SAMPLE_ALERT_SIGNAL);
    }
    const sent = await this.send(text);
    return { sent, text };
  }

  /** Heartbeat: every 5 min, if the feed is stale during market hours, alert (throttled). */
  @Cron('*/5 * * * *')
  async heartbeatCheck(now: Date = new Date()): Promise<void> {
    if (!this.supabase) return;
    try {
      // Gate 1: calendar hours — fast exit, no OANDA call needed for weekends.
      if (!isGoldMarketOpen(now)) return;
      // Gate 2: OANDA live tradeable flag catches the ~1h daily demo break (~21:00–22:00 UTC).
      // If OANDA is unreachable, return without firing — assume market may be in maintenance.
      let pricing: { tradeable: boolean };
      try {
        pricing = await this.broker.getPricing(SYMBOL);
      } catch {
        return;
      }
      if (!isMarketTradeableNow(isGoldMarketOpen(now), pricing.tradeable)) return;
      const { data } = await this.supabase
        .from('candles')
        .select('ts')
        .eq('symbol', SYMBOL)
        .eq('timeframe', '15min')
        .order('ts', { ascending: false })
        .limit(1);
      const barOpenTs = data && data.length ? (data[0].ts as string) : null;
      // Compare against bar CLOSE time (open + 15 min) so staleness means
      // "no bar has closed in >20 min", not "bar opened >20 min ago".
      const lastCloseTs = barOpenTs
        ? new Date(new Date(barOpenTs).getTime() + 15 * 60_000).toISOString()
        : null;
      if (isFeedStale(lastCloseTs, now, true)) {
        if (this.heartbeatThrottle.allow('heartbeat')) {
          await this.send(HEARTBEAT_MESSAGE);
        }
      }
    } catch (err) {
      await this.warnDb(`heartbeat check failed: ${String(err)}`);
    }
  }

  /** Write a WARN directly to system_events (no dependency on SystemEventsService,
   * which would create a DI cycle since it forwards ERRORs here). */
  private async warnDb(message: string, meta?: Record<string, unknown>): Promise<void> {
    this.logger.warn(message);
    if (!this.supabase) return;
    try {
      await this.supabase
        .from('system_events')
        .insert({ level: 'WARN', source: EVENT_SOURCE, message, meta: meta ?? null });
    } catch {
      /* best-effort */
    }
  }
}
