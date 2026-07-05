import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../supabase/supabase.provider';
import { SystemEventsService } from '../common/system-events.service';
import { computeSizing, SizingResult } from './sizing';
import { RISK_CEILING_PCT, TIER2_UNLOCK_RESOLVED, validateRiskPct } from './risk-tier';

const EVENT_SOURCE = 'risk-tier';

export interface UserSettings {
  account_size: number;
  account_ccy: string;
  risk_pct: number;
  current_tier: number;
}

export interface SignalSizing {
  suggested_lots: number | null;
  risk_amount_ccy: number | null;
  sizing_note: string;
  account_size: number;
  account_ccy: string;
}

export interface TierStatus {
  resolved_count: number;
  cumulative_r: number;
  tier2_unlocked: boolean;
  progress: string;
}

@Injectable()
export class SizingService {
  private readonly logger = new Logger('Sizing');

  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient | null,
    private readonly events: SystemEventsService,
  ) {}

  private async getUserSettings(): Promise<UserSettings> {
    if (!this.supabase) throw new Error('Supabase client not configured');
    const { data, error } = await this.supabase
      .from('user_settings')
      .select('account_size,account_ccy,risk_pct,current_tier')
      .eq('id', 1)
      .single();
    if (error) throw new Error(`user_settings query failed: ${error.message}`);
    return {
      account_size: Number(data.account_size),
      account_ccy: data.account_ccy as string,
      risk_pct: Number(data.risk_pct),
      current_tier: Number(data.current_tier),
    };
  }

  private async latestGbpUsd(): Promise<number | null> {
    if (!this.supabase) throw new Error('Supabase client not configured');
    const { data, error } = await this.supabase
      .from('fx_rates')
      .select('rate,ts')
      .eq('pair', 'GBP/USD')
      .order('ts', { ascending: false })
      .limit(1);
    if (error) throw new Error(`fx_rates query failed: ${error.message}`);
    return data && data.length ? Number(data[0].rate) : null;
  }

  /**
   * Sizing for a signal being generated (hook from SignalsService). Reads live
   * user_settings + latest FX. Returns the three columns to store on the signal.
   */
  async computeForSignal(entry: number, stop: number, takeProfit?: number): Promise<SignalSizing> {
    const settings = await this.getUserSettings();
    const rate = await this.latestGbpUsd();
    if (rate == null) {
      return {
        suggested_lots: null,
        risk_amount_ccy: null,
        sizing_note: 'SIZING UNAVAILABLE — no FX rate (GBP/USD) yet.',
        account_size: settings.account_size,
        account_ccy: settings.account_ccy,
      };
    }
    const r = computeSizing({
      accountSize: settings.account_size,
      accountCcy: settings.account_ccy,
      riskPct: settings.risk_pct,
      entry,
      stop,
      takeProfit,
      gbpUsdRate: rate,
    });
    return {
      suggested_lots: r.tooSmall ? 0 : r.suggestedLots,
      risk_amount_ccy: r.tooSmall ? null : round2(r.riskAmountCcy),
      sizing_note: r.sizingNote,
      account_size: settings.account_size,
      account_ccy: settings.account_ccy,
    };
  }

  /** Standalone calculator (pure compute over supplied inputs). Enforces the hard ceiling. */
  calculate(input: {
    account_size: number;
    account_ccy?: string;
    risk_pct: number;
    entry: number;
    stop: number;
    take_profit?: number;
    gbp_usd_rate: number;
  }): {
    suggested_lots: number;
    risk_amount_ccy: number;
    reward_amount_ccy: number;
    too_small: boolean;
    sizing_note: string;
  } {
    if (input.risk_pct > RISK_CEILING_PCT) {
      throw new BadRequestException(
        `risk_pct ${input.risk_pct}% exceeds the absolute hard ceiling of ${RISK_CEILING_PCT}%`,
      );
    }
    const r: SizingResult = computeSizing({
      accountSize: input.account_size,
      accountCcy: input.account_ccy ?? 'GBP',
      riskPct: input.risk_pct,
      entry: input.entry,
      stop: input.stop,
      takeProfit: input.take_profit,
      gbpUsdRate: input.gbp_usd_rate,
    });
    return {
      suggested_lots: r.suggestedLots,
      risk_amount_ccy: round2(r.riskAmountCcy),
      reward_amount_ccy: round2(r.rewardAmountCcy),
      too_small: r.tooSmall,
      sizing_note: r.sizingNote,
    };
  }

  /** Tier gate readout for the settings UI (later). */
  async tierStatus(): Promise<TierStatus> {
    if (!this.supabase) throw new Error('Supabase client not configured');
    const { data, error } = await this.supabase
      .from('signals')
      .select('status,entry_price,stop_loss,pips_result')
      .in('status', ['HIT_TP', 'HIT_SL', 'EXPIRED']);
    if (error) throw new Error(`resolved signals query failed: ${error.message}`);

    const resolved = data ?? [];
    let cumulativeR = 0;
    for (const s of resolved) {
      const risk = Math.abs(Number(s.entry_price) - Number(s.stop_loss));
      if (risk > 0 && s.pips_result != null) cumulativeR += Number(s.pips_result) / risk;
    }
    const resolved_count = resolved.length;
    const cumulative_r = round2(cumulativeR);
    return {
      resolved_count,
      cumulative_r,
      tier2_unlocked: resolved_count >= TIER2_UNLOCK_RESOLVED && cumulative_r > 0,
      progress: `${Math.min(resolved_count, TIER2_UNLOCK_RESOLVED)}/${TIER2_UNLOCK_RESOLVED}`,
    };
  }

  /**
   * Validate + apply a risk_pct change to user_settings. Enforces the hard
   * ceiling and Tier 2 gate/acknowledgment. Logs the acknowledgment for Tier 2.
   */
  async updateRiskPct(
    riskPct: number,
    acknowledgment?: string,
  ): Promise<{ ok: true; tier: 1 | 2; risk_pct: number }> {
    if (!this.supabase) throw new Error('Supabase client not configured');
    const status = await this.tierStatus();
    const v = validateRiskPct(
      riskPct,
      { resolvedCount: status.resolved_count, cumulativeR: status.cumulative_r },
      acknowledgment,
    );
    if (!v.ok) throw new BadRequestException(v.reason);

    const { error } = await this.supabase
      .from('user_settings')
      .update({ risk_pct: riskPct, current_tier: v.tier, updated_at: new Date().toISOString() })
      .eq('id', 1);
    if (error) throw new Error(`user_settings update failed: ${error.message}`);

    if (v.tier === 2) {
      const ts = new Date().toISOString();
      await this.events.info(
        EVENT_SOURCE,
        `Tier 2 (ELEVATED) risk_pct set to ${riskPct}% with typed acknowledgment at ${ts}`,
        { risk_pct: riskPct, acknowledged: true, ts },
      );
    }
    this.logger.log(`risk_pct updated to ${riskPct}% (Tier ${v.tier})`);
    return { ok: true, tier: v.tier as 1 | 2, risk_pct: riskPct };
  }
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
