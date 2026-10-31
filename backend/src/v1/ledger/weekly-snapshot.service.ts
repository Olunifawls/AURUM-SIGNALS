import { Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { BROKER_ADAPTER, IBrokerAdapter } from '../../broker/broker.interface';
import { scrubString } from '../../killswitch/scrub';
import { TradingStateService } from '../../risk/trading-state.service';
import { SUPABASE_CLIENT } from '../../supabase/supabase.provider';
import { lastEventAt, effectiveSchedule } from '../calendar/economic-calendar';
import { DAY_MS, RULESET_VERSION } from '../v1.constants';
import { ForwardTestService } from './forward-test.service';
import { buildSnapshotPayload, ClosedTrade, HaltEvent, HaltRow, haltsThisWeek, SnapshotPayload } from './weekly-snapshot';

const PAGE = 1000;

export interface StoredSnapshot {
  createdAt: string;
  payload: SnapshotPayload;
}

/** The weekly numbers, taken from the same ledger as the Forward Test page. */
@Injectable()
export class WeeklySnapshotService {
  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient | null,
    @Inject(BROKER_ADAPTER) private readonly broker: IBrokerAdapter,
    private readonly ledger: ForwardTestService,
    private readonly state: TradingStateService,
  ) {}

  private db(): SupabaseClient {
    if (!this.supabase) throw new Error('Supabase client not configured');
    return this.supabase;
  }

  private checked<T>(label: string, r: { data: T | null; error: { message: string } | null }): T {
    if (r.error) throw new Error(`${label} query failed: ${r.error.message}`);
    return r.data as T;
  }

  async build(now: Date): Promise<SnapshotPayload> {
    const db = this.db();
    const first = this.checked('signal_evaluations', await db.from('signal_evaluations').select('evaluated_at').order('evaluated_at', { ascending: true }).limit(1));
    const v1StartedAt = (first?.[0]?.evaluated_at as string | undefined) ?? null;
    const weekStart = new Date(now.getTime() - 7 * DAY_MS).toISOString();

    const halts = await this.state.getActiveHalts(now); // first: it expires timed halts
    const [report, trades, open, errors, weekRef, hwm, haltEvents, haltRows, account] = await Promise.all([
      this.ledger.report(),
      v1StartedAt ? this.closedTrades(v1StartedAt) : Promise.resolve<ClosedTrade[]>([]),
      db.from('positions').select('id', { count: 'exact', head: true }).eq('mode', 'demo').eq('status', 'OPEN'),
      db.from('system_events').select('id', { count: 'exact', head: true }).eq('level', 'ERROR').gte('created_at', weekStart),
      db.from('equity_snapshots').select('equity').eq('snapshot_type', 'WEEKLY_REF').order('ts', { ascending: false }).limit(1),
      db.from('equity_snapshots').select('high_water_mark').order('high_water_mark', { ascending: false }).limit(1),
      this.haltEvents(weekStart),
      db.from('system_halts').select('halt_type,reason,active,triggered_at,cleared_at'),
      this.broker.getAccount().catch(() => null), // the snapshot still writes if the broker is down
    ]);
    if (open.error) throw new Error(`positions query failed: ${open.error.message}`);
    if (errors.error) throw new Error(`system_events query failed: ${errors.error.message}`);
    const rows = this.checked('system_halts', haltRows) as HaltRow[];

    const num = (v: unknown): number | null => (v == null ? null : Number(v));
    return buildSnapshotPayload({
      now,
      ruleset: RULESET_VERSION,
      report,
      trades,
      activeHalts: halts.map((h) => h.halt_type),
      haltsThisWeek: haltsThisWeek(haltEvents, rows.map((r) => ({ ...r, reason: r.reason && scrubString(r.reason) })), new Date(weekStart)),
      errorsThisWeek: errors.count ?? 0,
      v1StartedAt,
      lastCalendarEvent: lastEventAt(effectiveSchedule().events),
      account: {
        ccy: account?.currency ?? 'GBP',
        equity: account?.equity ?? null,
        startOfWeekEquity: num(weekRef.data?.[0]?.equity),
        highWaterMark: num(hwm.data?.[0]?.high_water_mark),
        openPositions: open.count ?? 0,
      },
    });
  }

  /** Activations only: rejections share this event_type and have no meta. A breaker
   * stuck re-firing can log thousands in a week, so this pages. */
  private async haltEvents(weekStart: string): Promise<HaltEvent[]> {
    const out: HaltEvent[] = [];
    for (;;) {
      const page = this.checked(
        'risk_events',
        await this.db()
          .from('risk_events')
          .select('created_at,message,meta')
          .eq('event_type', 'TRADING_HALTED')
          .not('meta->>haltType', 'is', null)
          .gte('created_at', weekStart)
          .order('created_at', { ascending: true })
          .range(out.length, out.length + PAGE - 1),
      ) as HaltEvent[];
      out.push(...(page ?? []));
      if ((page ?? []).length < PAGE) return out;
    }
  }

  private async closedTrades(sinceIso: string): Promise<ClosedTrade[]> {
    const rows = this.checked(
      'positions',
      await this.db().from('positions').select('closed_at,realized_r,slippage_points').eq('mode', 'demo').eq('status', 'CLOSED').gte('closed_at', sinceIso),
    );
    return (rows ?? []).map((p) => ({
      closedAt: p.closed_at as string,
      realizedR: p.realized_r == null ? null : Number(p.realized_r),
      slippagePoints: p.slippage_points == null ? null : Number(p.slippage_points),
    }));
  }

  /** Builds one snapshot and writes one row. */
  async write(now: Date): Promise<StoredSnapshot> {
    const payload = await this.build(now);
    const { data, error } = await this.db().from('weekly_snapshots').insert({ ruleset: RULESET_VERSION, payload }).select('created_at').single();
    if (error) throw new Error(`weekly_snapshots insert failed: ${error.message}`);
    return { createdAt: (data as { created_at: string }).created_at, payload };
  }

  async latest(): Promise<StoredSnapshot | null> {
    const rows = this.checked('weekly_snapshots', await this.db().from('weekly_snapshots').select('created_at,payload').order('created_at', { ascending: false }).limit(1));
    const row = rows?.[0] as { created_at: string; payload: SnapshotPayload } | undefined;
    return row ? { createdAt: row.created_at, payload: row.payload } : null;
  }
}
