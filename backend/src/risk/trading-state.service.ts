import { Inject, Injectable, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../supabase/supabase.provider';

export type HaltType =
  | 'MANUAL_HALT'
  | 'VOLATILITY_COOLDOWN'
  | 'SESSION_GAP'
  | 'DAILY_LOSS'
  | 'WEEKLY_LOSS'
  | 'DRAWDOWN'
  | 'CONSECUTIVE_SL'
  | 'FEED_STALE'
  | 'BROKER_ERROR'
  | 'RECONCILE_HALT';

export interface HaltRow {
  halt_type: HaltType;
  active: boolean;
  scope: 'NEW_ORDERS' | 'ALL';
  reason?: string;
  requires_manual: boolean;
  clears_at?: string | null;
}

export interface SetHaltOpts {
  scope?: 'NEW_ORDERS' | 'ALL';
  reason?: string;
  requiresManual?: boolean;
  clearsAt?: Date | null;
  meta?: Record<string, unknown>;
}

/**
 * Persistent trading-state / halt store (INC-4). Halts survive restarts (backed
 * by system_halts). VOLATILITY_COOLDOWN is surfaced separately (INC-2 check 4a);
 * all OTHER active halts mean "halted" (check 1). Timed halts auto-clear once
 * their clears_at passes; DRAWDOWN never auto-clears (manual /resume + confirm).
 */
@Injectable()
export class TradingStateService {
  private readonly logger = new Logger('TradingState');

  constructor(@Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient | null = null) {}

  async setHalt(type: HaltType, opts: SetHaltOpts = {}): Promise<void> {
    if (!this.supabase) return;
    const now = new Date().toISOString();
    await this.supabase.from('system_halts').upsert(
      {
        halt_type: type,
        active: true,
        scope: opts.scope ?? 'NEW_ORDERS',
        reason: opts.reason ?? null,
        requires_manual: opts.requiresManual ?? false,
        triggered_at: now,
        clears_at: opts.clearsAt ? opts.clearsAt.toISOString() : null,
        cleared_at: null,
        meta: opts.meta ?? null,
        updated_at: now,
      },
      { onConflict: 'halt_type' },
    );
  }

  async clearHalt(type: HaltType): Promise<void> {
    if (!this.supabase) return;
    const now = new Date().toISOString();
    await this.supabase.from('system_halts').update({ active: false, cleared_at: now, updated_at: now }).eq('halt_type', type);
  }

  /** Active halts, after auto-expiring any timed (non-manual) halt whose clears_at has passed. */
  async getActiveHalts(now: Date = new Date()): Promise<HaltRow[]> {
    if (!this.supabase) return [];
    const { data } = await this.supabase.from('system_halts').select('*').eq('active', true);
    const rows = (data ?? []) as HaltRow[];
    const live: HaltRow[] = [];
    for (const r of rows) {
      if (!r.requires_manual && r.clears_at && new Date(r.clears_at).getTime() <= now.getTime()) {
        await this.clearHalt(r.halt_type); // auto-clear expired timed halt
      } else {
        live.push(r);
      }
    }
    return live;
  }

  /** check 1: any active halt EXCEPT the volatility cooldown (which is check 4a). */
  async isHalted(now: Date = new Date()): Promise<boolean> {
    const halts = await this.getActiveHalts(now);
    return halts.some((h) => h.halt_type !== 'VOLATILITY_COOLDOWN');
  }

  async isVolatilityCooldown(now: Date = new Date()): Promise<boolean> {
    const halts = await this.getActiveHalts(now);
    return halts.some((h) => h.halt_type === 'VOLATILITY_COOLDOWN');
  }

  /** /resume: clear resumable MANUAL halts. NOT loss-limit (auto-only) or DRAWDOWN
   * (needs confirmation). Returns the halt types cleared. */
  async resumeManual(now: Date = new Date()): Promise<HaltType[]> {
    const halts = await this.getActiveHalts(now);
    const resumable = halts.filter((h) => h.requires_manual && h.halt_type !== 'DRAWDOWN').map((h) => h.halt_type);
    for (const t of resumable) await this.clearHalt(t);
    return resumable;
  }

  /** /resume WITH confirmation: clear the absolute-drawdown halt. */
  async resumeDrawdown(): Promise<boolean> {
    const halts = await this.getActiveHalts();
    if (!halts.some((h) => h.halt_type === 'DRAWDOWN')) return false;
    await this.clearHalt('DRAWDOWN');
    return true;
  }
}
