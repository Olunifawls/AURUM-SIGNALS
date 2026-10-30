import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../supabase/supabase.provider';
import { BROKER_ADAPTER, IBrokerAdapter } from '../../broker/broker.interface';
import { AlertsService } from '../../alerts/alerts.service';
import { realizedR } from '../../execution/exec-util';
import { level2Config } from '../../level2/level2.config';
import { EconomicEvent, effectiveSchedule } from '../calendar/economic-calendar';
import { NEWS_EXIT_MODE, NewsExitMode } from '../v1.constants';
import { dueTier1Event } from './news-exit';

export const NEWS_EXIT = 'NEWS_EXIT';
const XAU = 'XAU_USD';

/**
 * News exit around tier-1 releases, in the mode the ruleset sets. SHADOW records the
 * price each open L2 position would have closed at and never closes it. HARD closes
 * every open L2 position from 15 minutes before the release.
 */
@Injectable()
export class NewsExitService {
  private readonly logger = new Logger('NewsExit');
  private readonly schedule = effectiveSchedule().events;
  protected readonly mode: NewsExitMode = NEWS_EXIT_MODE;

  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient | null,
    @Inject(BROKER_ADAPTER) private readonly broker: IBrokerAdapter,
    private readonly alerts: AlertsService,
  ) {}

  /** Each tick re-reads OPEN positions, so one that failed is retried. Second 20: T-15
   * always lands on a reconcile minute, and reconcile must not race a close. */
  @Cron('20 * * * * *')
  async tick(now: Date = new Date()): Promise<number> {
    if (!this.supabase || !process.env.OANDA_ACCOUNT_ID_DEMO) return 0;
    const event = dueTier1Event(this.schedule, now);
    if (!event) return 0;

    const { data, error } = await this.supabase.from('positions').select('*').eq('status', 'OPEN');
    if (error) {
      await this.alertFailure(event, `could not read open positions: ${error.message}`);
      return 0;
    }
    let handled = 0;
    for (const pos of data ?? []) {
      try {
        if (await (this.mode === 'HARD' ? this.closePosition(pos, event, now) : this.recordShadow(pos, event))) handled++;
      } catch (err) {
        await this.alertFailure(event, `position ${pos.id}: ${String(err)}`);
      }
    }
    return handled;
  }

  /** The price this position would close at now. The unique key keeps the first row,
   * so later ticks in the window cannot replace the T-15 price. */
  private async recordShadow(pos: Record<string, any>, event: EconomicEvent): Promise<boolean> {
    const quote = await this.broker.getPricing(XAU);
    const price = pos.side === 'BUY' ? quote.bid : quote.ask;
    if (!(price > 0)) throw new Error('no usable quote');
    const { error } = await this.supabase!.from('trade_watch_events').upsert(
      {
        kind: 'NEWS_EXIT_SHADOW',
        position_id: pos.id,
        signal_id: pos.signal_id ?? null,
        agent: event.name,
        verdict: null,
        flipped: false,
        bar_ts: event.at,
        price,
        detail: { event: event.name, releaseAt: event.at },
      },
      { onConflict: 'position_id,kind,agent,bar_ts', ignoreDuplicates: true },
    );
    if (error) throw new Error(`trade_watch_events insert failed: ${error.message}`);
    return true;
  }

  private async closePosition(pos: Record<string, any>, event: EconomicEvent, now: Date): Promise<boolean> {
    const tradeId = pos.broker_trade_id as string | null;
    if (!tradeId) throw new Error('no broker trade id');

    const res = await this.broker.closeTrade(tradeId);
    if (!res.closed) throw new Error(`broker did not close trade ${tradeId}`);

    const trade = await this.broker.getTrade(tradeId);
    const closePrice = trade.closePrice ?? Number(pos.entry_price);
    const initialStop = Number(pos.initial_stop_loss ?? pos.stop_loss);
    const r = realizedR(Number(pos.entry_price), initialStop, closePrice, pos.side);
    const stamp = now.toISOString();

    await this.supabase!
      .from('positions')
      .update({
        status: 'CLOSED',
        close_reason: NEWS_EXIT,
        closed_at: trade.closeTime ?? stamp,
        close_price: closePrice,
        realized_pl: trade.realizedPl,
        realized_pl_ccy: level2Config().demo.accountCcy,
        realized_r: r,
        meta: { ...(pos.meta ?? {}), news_exit: { event: event.name, release_at: event.at } },
        updated_at: stamp,
      })
      .eq('id', pos.id);
    await this.supabase!.from('risk_events').insert({
      mode: pos.mode ?? 'demo',
      event_type: NEWS_EXIT,
      severity: 'INFO',
      signal_id: pos.signal_id ?? null,
      message: `${NEWS_EXIT} ${event.name}: closed trade ${tradeId} at ${closePrice} (${r}R), release at ${event.at}`,
      meta: { event: event.name, releaseAt: event.at, positionId: pos.id, tradeId, closePrice, realizedR: r },
    });
    this.logger.log(`closed ${tradeId} ahead of ${event.name}`);
    void this.alerts.send(`📰 ${NEWS_EXIT} ${event.name} — closed ${pos.side} at ${closePrice} (${r}R)`).catch(() => undefined);
    return true;
  }

  private async alertFailure(event: EconomicEvent, detail: string): Promise<void> {
    this.logger.error(`${event.name}: ${detail}`);
    await this.alerts.sendAdminError(`news-exit-${event.name}`, `news exit ${this.mode} failed: ${detail}`).catch(() => undefined);
  }
}
