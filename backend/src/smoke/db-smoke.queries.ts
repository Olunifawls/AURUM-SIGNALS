/**
 * Every read the smoke check runs. `select` is copied exactly from `source`;
 * postgrest-embeds.spec.ts fails if the two drift apart. `filters` mirror the
 * caller, so a renamed column fails here too; their values do not matter.
 */
export interface SmokeQuery {
  name: string;
  source: string;
  table: string;
  select: string;
  filters?: Record<string, string>;
}

const LEDGER = 'v1/ledger/forward-test.service.ts';
const WEEKLY = 'v1/ledger/weekly-snapshot.service.ts';
const CHIEF = 'v1/chief/chief-analyst.service.ts';
const V1_DATA = 'v1/data/v1-data.service.ts';
const EXECUTOR = 'execution/execution.service.ts';
const RISK = 'risk/risk-manager.service.ts';
const STATE = 'risk/trading-state.service.ts';

const SYMBOL = 'eq.XAU/USD';
const SINCE = 'gte.2026-01-01T00:00:00Z';

export const SMOKE_QUERIES: SmokeQuery[] = [
  // Forward Test page, weekly snapshot and /report all go through this ledger.
  {
    name: 'forward-test ledger: evaluations',
    source: LEDGER,
    table: 'signal_evaluations',
    select:
      'signal_id,eligible,duplicate_of,fire_price,agents,ai_summary,signals!signal_evaluations_signal_id_fkey(timeframe,created_at,status,direction,entry_price,stop_loss,take_profit,pips_result,resolved_at,resolved_price)',
    filters: { ruleset_version: 'eq.v1', order: 'id.asc' },
  },
  {
    name: 'forward-test ledger: positions',
    source: LEDGER,
    table: 'positions',
    select: 'id,signal_id,side,entry_price,stop_loss,initial_stop_loss,realized_r,close_reason,closed_at,status,meta',
    filters: { order: 'id.asc' },
  },
  { name: 'forward-test ledger: watch events', source: LEDGER, table: 'trade_watch_events', select: 'id,kind,position_id,agent,flipped,bar_ts,price', filters: { order: 'id.asc' } },

  // Weekly snapshot.
  { name: 'weekly: v1 start', source: WEEKLY, table: 'signal_evaluations', select: 'evaluated_at', filters: { order: 'evaluated_at.asc' } },
  { name: 'weekly: open positions', source: WEEKLY, table: 'positions', select: 'id', filters: { mode: 'eq.demo', status: 'eq.OPEN' } },
  { name: 'weekly: errors', source: WEEKLY, table: 'system_events', select: 'id', filters: { level: 'eq.ERROR', created_at: SINCE } },
  { name: 'weekly: week-start equity', source: WEEKLY, table: 'equity_snapshots', select: 'equity', filters: { snapshot_type: 'eq.WEEKLY_REF', order: 'ts.desc' } },
  { name: 'weekly: high water mark', source: WEEKLY, table: 'equity_snapshots', select: 'high_water_mark', filters: { order: 'high_water_mark.desc' } },
  { name: 'weekly: halt rows', source: WEEKLY, table: 'system_halts', select: 'halt_type,reason,active,triggered_at,cleared_at' },
  {
    name: 'weekly: halt events',
    source: WEEKLY,
    table: 'risk_events',
    select: 'created_at,message,meta',
    filters: { event_type: 'eq.TRADING_HALTED', 'meta->>haltType': 'not.is.null', created_at: SINCE, order: 'created_at.asc' },
  },
  { name: 'weekly: closed trades', source: WEEKLY, table: 'positions', select: 'closed_at,realized_r,slippage_points', filters: { mode: 'eq.demo', status: 'eq.CLOSED', closed_at: SINCE } },

  // /report: the latest snapshot, or a live build from the reads above.
  { name: '/report: latest snapshot', source: WEEKLY, table: 'weekly_snapshots', select: 'created_at,payload', filters: { order: 'created_at.desc' } },
  { name: '/report: active halts', source: STATE, table: 'system_halts', select: '*', filters: { active: 'eq.true' } },

  // Chief analyst, including the duplicate check.
  { name: 'chief: setup and duplicate check', source: CHIEF, table: 'signals', select: 'id,symbol,timeframe,direction,entry_price,stop_loss,take_profit,created_at', filters: { symbol: SYMBOL } },
  { name: 'chief: fire price candle', source: CHIEF, table: 'candles', select: 'ts,close', filters: { symbol: SYMBOL, timeframe: 'eq.15min', order: 'ts.desc' } },
  { name: 'chief: gold daily', source: V1_DATA, table: 'candles', select: 'ts,close', filters: { symbol: SYMBOL, timeframe: 'eq.1day', order: 'ts.desc' } },
  { name: 'chief: macro daily', source: V1_DATA, table: 'macro_candles', select: 'ts,close', filters: { order: 'ts.desc' } },
  { name: 'chief: COT reports', source: V1_DATA, table: 'cot_reports', select: 'report_date,managed_money_long,managed_money_short', filters: { order: 'report_date.desc' } },

  // Executor.
  {
    name: 'executor: new signals',
    source: EXECUTOR,
    table: 'signals',
    select: 'id,timeframe,direction,entry_price,stop_loss,take_profit,track,status,created_at',
    filters: { symbol: SYMBOL, status: 'eq.OPEN', track: 'eq.core', timeframe: 'in.(1h,4h)', order: 'created_at.desc' },
  },
  { name: 'executor: orders by signal', source: EXECUTOR, table: 'orders', select: 'signal_id' },
  { name: 'executor: v1 veto', source: EXECUTOR, table: 'signal_evaluations', select: 'eligible,duplicate_of,agents' },
  { name: 'executor: duplicate setup', source: EXECUTOR, table: 'signals', select: 'id', filters: { symbol: SYMBOL } },
  { name: 'executor: positions by signal', source: EXECUTOR, table: 'positions', select: 'signal_id' },
  { name: 'executor: rejection logged', source: EXECUTOR, table: 'risk_events', select: 'id' },
  { name: 'executor: broker account', source: EXECUTOR, table: 'broker_accounts', select: 'id', filters: { broker: 'eq.OANDA', mode: 'eq.demo' } },
  { name: 'executor: open positions', source: EXECUTOR, table: 'positions', select: '*', filters: { status: 'eq.OPEN' } },

  // Risk checks the executor runs before an order, including the other signals embed.
  { name: 'risk: GBP/USD', source: RISK, table: 'fx_rates', select: 'rate', filters: { pair: 'eq.GBP/USD', order: 'ts.desc' } },
  { name: 'risk: resolved trades', source: RISK, table: 'positions', select: 'id', filters: { mode: 'eq.demo', status: 'eq.CLOSED' } },
  { name: 'risk: same side and timeframe', source: RISK, table: 'positions', select: 'side, signals(timeframe)', filters: { status: 'eq.OPEN' } },
  { name: 'risk: equity baseline', source: RISK, table: 'equity_snapshots', select: 'equity', filters: { order: 'ts.desc' } },
];
