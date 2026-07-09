import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../supabase/supabase.provider';
import { BROKER_ADAPTER, IBrokerAdapter } from '../broker/broker.interface';
import { level2Config } from '../level2/level2.config';
import { SYMBOL } from '../ingestion/ingestion.constants';

/**
 * Breakeven-stop manager. Runs every 5 minutes (same cadence as reconcile).
 * When BREAKEVEN_STOP_ENABLED=true and an open trade's unrealised move reaches
 * +1R (price has moved >= 1× stop distance in the trade's favour), modifies the
 * broker-side stop-loss order to entry + buffer (BUY) or entry - buffer (SELL).
 *
 * Invariants:
 *  - Only fires once per trade (idempotent via meta.breakevenStopSet).
 *  - Never moves SL back (only forward, toward BE).
 *  - Stop remains at the broker (broker is always the authority).
 *  - DB stop_loss is updated to match what was sent to the broker.
 *  - A risk_event row is logged when the SL is moved.
 *
 * Buffer: BREAKEVEN_BUFFER_POINTS (default 0.1 USD price points on XAU — well
 * above the typical spread and ensures the position is genuinely non-losing
 * before the stop is moved).
 */
@Injectable()
export class BreakevenStopService {
  private readonly logger = new Logger('BreakevenStop');

  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient | null,
    @Inject(BROKER_ADAPTER) private readonly broker: IBrokerAdapter,
  ) {}

  @Cron('*/5 * * * *')
  async checkBreakeven(now: Date = new Date()): Promise<number> {
    if (!this.supabase || !process.env.OANDA_ACCOUNT_ID_DEMO) return 0;
    const cfg = level2Config();
    if (!cfg.breakevenStopEnabled) return 0;

    const { data: positions } = await this.supabase
      .from('positions')
      .select('id,entry_price,stop_loss,side,broker_trade_id,meta,mode')
      .eq('status', 'OPEN');

    if (!positions?.length) return 0;

    // Fetch live mid price once for all positions (same instrument).
    let mid: number;
    try {
      const pricing = await this.broker.getPricing(SYMBOL);
      mid = (pricing.bid + pricing.ask) / 2;
    } catch (err) {
      this.logger.warn(`breakeven check: getPricing failed — ${String(err)}`);
      return 0;
    }

    let moved = 0;
    const ts = now.toISOString();

    for (const pos of positions) {
      const meta: Record<string, unknown> = (pos.meta as Record<string, unknown>) ?? {};
      if (meta.breakevenStopSet) continue;
      if (!pos.broker_trade_id) continue;

      const entry = Number(pos.entry_price);
      const sl = Number(pos.stop_loss);
      const stopDist = Math.abs(entry - sl);
      if (stopDist === 0) continue;

      const atPlusOneR =
        pos.side === 'BUY' ? mid >= entry + stopDist : mid <= entry - stopDist;
      if (!atPlusOneR) continue;

      const buffer = cfg.breakevenBufferPoints;
      const newSL = pos.side === 'BUY' ? entry + buffer : entry - buffer;

      // Only advance — never move SL backward (safety guard for SELL where entry > sl).
      if (pos.side === 'BUY' && newSL <= sl) continue;
      if (pos.side === 'SELL' && newSL >= sl) continue;

      const result = await this.broker.modifyTradeSL(pos.broker_trade_id, newSL).catch((err) => {
        this.logger.error(`modifyTradeSL failed for ${pos.id}: ${String(err)}`);
        return { modified: false };
      });

      if (!result.modified) continue;

      // Update DB to match broker.
      await this.supabase.from('positions').update({
        stop_loss: newSL,
        meta: { ...meta, breakevenStopSet: true, breakevenMovedAt: ts, originalSL: sl },
        updated_at: ts,
      }).eq('id', pos.id);

      await this.supabase.from('risk_events').insert({
        mode: pos.mode ?? 'demo',
        event_type: 'BREAKEVEN_STOP_MOVED',
        severity: 'INFO',
        message: `breakeven SL moved: position ${pos.id} ${pos.side} entry=${entry} SL ${sl}→${newSL} (buffer=${buffer})`,
        meta: { positionId: pos.id, tradeId: pos.broker_trade_id, entry, oldSL: sl, newSL, buffer, mid },
      });

      this.logger.log(`breakeven SL moved for ${pos.id}: ${sl} → ${newSL} (mid=${mid})`);
      moved++;
    }

    return moved;
  }
}
