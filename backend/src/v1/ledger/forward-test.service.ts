import { Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../supabase/supabase.provider';
import { NEWS_EXIT_MODE, RULESET_VERSION } from '../v1.constants';
import { LedgerRow, NewsExitRow, summarise, WatchRow } from './forward-test';

const PAGE = 1000;

/** Forward-test read model. Read-only. */
@Injectable()
export class ForwardTestService {
  constructor(@Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient | null) {}

  private db(): SupabaseClient {
    if (!this.supabase) throw new Error('Supabase client not configured');
    return this.supabase;
  }

  /** Every row, past PostgREST's page cap. */
  private async all<T>(table: string, columns: string, filter: (q: any) => any = (q) => q): Promise<T[]> {
    const out: T[] = [];
    for (;;) {
      const { data, error } = await filter(this.db().from(table).select(columns)).order('id').range(out.length, out.length + PAGE - 1);
      if (error) throw new Error(`${table} query failed: ${error.message}`);
      out.push(...((data ?? []) as T[]));
      if ((data ?? []).length < PAGE) return out;
    }
  }

  async report() {
    const [evaluations, positions, watch] = await Promise.all([
      this.all<any>(
        'signal_evaluations',
        'signal_id,eligible,duplicate_of,agents,ai_summary,signals(timeframe,created_at,status,entry_price,stop_loss,pips_result,resolved_at,resolved_price)',
        (q) => q.eq('ruleset_version', RULESET_VERSION),
      ),
      this.all<any>('positions', 'id,signal_id,side,entry_price,stop_loss,initial_stop_loss,realized_r,close_reason,closed_at,status,meta'),
      this.all<any>('trade_watch_events', 'id,kind,position_id,agent,flipped,bar_ts,price'),
    ]);

    const signals = new Map(evaluations.map((e) => [e.signal_id as string, e.signals]));
    const ledger: LedgerRow[] = evaluations.map((e) => {
      const s = e.signals ?? {};
      const risk = Math.abs(Number(s.entry_price) - Number(s.stop_loss));
      return {
        signalId: e.signal_id,
        timeframe: s.timeframe,
        createdAt: s.created_at,
        eligible: e.eligible,
        duplicateOf: e.duplicate_of ?? null,
        agents: e.agents ?? [],
        rMultiple: s.resolved_at != null && s.pips_result != null && risk > 0 ? Number(s.pips_result) / risk : null,
        resolvedAt: s.resolved_at ?? null,
      };
    });

    const stopOf = (p: any): number | null => {
      const stop = p.initial_stop_loss ?? p.stop_loss;
      return stop == null ? null : Number(stop);
    };
    const exits: NewsExitRow[] = positions
      .filter((p) => p.close_reason === 'NEWS_EXIT')
      .map((p) => {
        const price = signals.get(p.signal_id)?.resolved_price;
        return {
          positionId: p.id,
          event: p.meta?.news_exit?.event ?? null,
          closedAt: p.closed_at,
          side: p.side,
          entry: Number(p.entry_price),
          initialStop: stopOf(p) as number, // set by the same path that wrote the exit
          realizedR: p.realized_r == null ? null : Number(p.realized_r),
          signalResolvedPrice: price == null ? null : Number(price),
        };
      });

    const byId = new Map(positions.map((p) => [p.id as string, p]));
    const watchRows: WatchRow[] = watch.map((w) => {
      const p = byId.get(w.position_id);
      return {
        kind: w.kind,
        positionId: w.position_id,
        agent: w.agent,
        flipped: w.flipped,
        barTs: w.bar_ts,
        price: w.price == null ? null : Number(w.price),
        side: p?.side ?? null,
        entry: p ? Number(p.entry_price) : null,
        initialStop: p ? stopOf(p) : null,
        finalR: p?.status === 'CLOSED' && p.realized_r != null ? Number(p.realized_r) : null,
      };
    });

    const recent = [...evaluations]
      .sort((a, b) => String(b.signals?.created_at).localeCompare(String(a.signals?.created_at)))
      .slice(0, 20)
      .map((e) => ({
        signalId: e.signal_id,
        timeframe: e.signals?.timeframe,
        createdAt: e.signals?.created_at,
        status: e.signals?.status,
        eligible: e.eligible,
        duplicateOf: e.duplicate_of ?? null,
        agents: (e.agents ?? []).map((a: any) => ({ agent: a.agent, verdict: a.verdict, hard: a.hard })),
        aiSummary: e.ai_summary ?? null,
      }));

    return { ruleset: RULESET_VERSION, newsExitMode: NEWS_EXIT_MODE, ...summarise(ledger, exits, watchRows), recent };
  }
}
