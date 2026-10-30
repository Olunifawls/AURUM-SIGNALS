-- AURUM V1 — ADDITIVE: data for the multi-agent ruleset and its forward-test ledger.
-- New tables only, plus the two archive functions from 0010 re-created to cover
-- them. Apply 0010 first.

-- Daily macro candles (EUR_USD, USD_JPY, USB10Y_USD, USB02Y_USD), mid prices, same
-- OANDA settings as gold. A separate table because candles rounds to 4 decimals and
-- EUR_USD quotes 5. Write-once, like candles.
create table if not exists macro_candles (
  id bigint generated always as identity primary key,
  instrument text not null,
  ts timestamptz not null,
  open numeric(14,6) not null, high numeric(14,6) not null,
  low numeric(14,6) not null, close numeric(14,6) not null,
  volume numeric,
  unique (instrument, ts)
);
create index if not exists idx_macro_candles_lookup on macro_candles (instrument, ts desc);

-- CFTC disaggregated futures-only, gold (088691), managed money.
create table if not exists cot_reports (
  report_date date primary key,
  managed_money_long bigint not null,
  managed_money_short bigint not null,
  fetched_at timestamptz not null default now()
);

-- One evaluation per L1 signal: the forward-test ledger. L1 outcome stays on signals.
create table if not exists signal_evaluations (
  id uuid primary key default gen_random_uuid(),
  signal_id uuid not null unique references signals (id) on delete cascade,
  ruleset_version text not null,
  evaluated_at timestamptz not null default now(),
  eligible boolean not null,
  agents jsonb not null,
  evidence jsonb not null,
  ai_summary text,
  ai_model text
);
create index if not exists idx_signal_evaluations_ruleset on signal_evaluations (ruleset_version, evaluated_at desc);

-- SHADOW findings on open trades. These never act. One row per position, kind,
-- agent and bar, so a re-run cannot double count.
create table if not exists trade_watch_events (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  kind text not null check (kind in ('THESIS_CHECK','DOLLAR_SHOCK')),
  position_id uuid references positions (id) on delete set null,
  signal_id uuid references signals (id) on delete set null,
  agent text not null,
  verdict text,
  flipped boolean not null default false,
  bar_ts timestamptz not null,
  price numeric(12,4),
  detail jsonb,
  unique (position_id, kind, agent, bar_ts)
);
create index if not exists idx_trade_watch_position on trade_watch_events (position_id, kind, bar_ts desc);

alter table macro_candles enable row level security;
alter table cot_reports enable row level security;
alter table signal_evaluations enable row level security;
alter table trade_watch_events enable row level security;
revoke all on macro_candles from anon, authenticated;
revoke all on cot_reports from anon, authenticated;
revoke all on signal_evaluations from anon, authenticated;
revoke all on trade_watch_events from anon, authenticated;

-- The wipe must archive the new ledger tables too: signal_evaluations cascades from
-- signals and would be destroyed silently, the failure 0010 exists to prevent.
create or replace function archive_and_wipe_ledger(p_reason text)
returns jsonb
language plpgsql
security definer  -- runs as owner to bypass RLS on protected tables
set search_path = public
as $$
declare
  v_batch      uuid := gen_random_uuid();
  n_risk       int := 0;
  n_paths      int := 0;
  n_evals      int := 0;
  n_watch      int := 0;
  n_equity     int := 0;
  n_positions  int := 0;
  n_orders     int := 0;
  n_signals    int := 0;
  n_perf       int := 0;
begin
  insert into ledger_archive (batch_id, reason, source_table, source_id, row_data)
    select v_batch, p_reason, 'risk_events', t.id::text, to_jsonb(t) from risk_events t;
  delete from risk_events where true;
  get diagnostics n_risk = row_count;

  insert into ledger_archive (batch_id, reason, source_table, source_id, row_data)
    select v_batch, p_reason, 'signal_path_metrics', t.id::text, to_jsonb(t) from signal_path_metrics t;
  delete from signal_path_metrics where true;
  get diagnostics n_paths = row_count;

  insert into ledger_archive (batch_id, reason, source_table, source_id, row_data)
    select v_batch, p_reason, 'signal_evaluations', t.id::text, to_jsonb(t) from signal_evaluations t;
  delete from signal_evaluations where true;
  get diagnostics n_evals = row_count;

  insert into ledger_archive (batch_id, reason, source_table, source_id, row_data)
    select v_batch, p_reason, 'trade_watch_events', t.id::text, to_jsonb(t) from trade_watch_events t;
  delete from trade_watch_events where true;
  get diagnostics n_watch = row_count;

  insert into ledger_archive (batch_id, reason, source_table, source_id, row_data)
    select v_batch, p_reason, 'equity_snapshots', t.id::text, to_jsonb(t) from equity_snapshots t;
  delete from equity_snapshots where true;
  get diagnostics n_equity = row_count;

  insert into ledger_archive (batch_id, reason, source_table, source_id, row_data)
    select v_batch, p_reason, 'positions', t.id::text, to_jsonb(t) from positions t;
  delete from positions where true;
  get diagnostics n_positions = row_count;

  insert into ledger_archive (batch_id, reason, source_table, source_id, row_data)
    select v_batch, p_reason, 'orders', t.id::text, to_jsonb(t) from orders t;
  delete from orders where true;
  get diagnostics n_orders = row_count;

  insert into ledger_archive (batch_id, reason, source_table, source_id, row_data)
    select v_batch, p_reason, 'signals', t.id::text, to_jsonb(t) from signals t;
  delete from signals where true;
  get diagnostics n_signals = row_count;

  insert into ledger_archive (batch_id, reason, source_table, source_id, row_data)
    select v_batch, p_reason, 'performance_daily', t.day::text, to_jsonb(t) from performance_daily t;
  delete from performance_daily where true;
  get diagnostics n_perf = row_count;

  return jsonb_build_object(
    'batch_id',            v_batch,
    'risk_events',         n_risk,
    'signal_path_metrics', n_paths,
    'signal_evaluations',  n_evals,
    'trade_watch_events',  n_watch,
    'equity_snapshots',    n_equity,
    'positions',           n_positions,
    'orders',              n_orders,
    'signals',             n_signals,
    'performance_daily',   n_perf
  );
end;
$$;
revoke all on function archive_and_wipe_ledger(text) from public, anon, authenticated;
grant execute on function archive_and_wipe_ledger(text) to service_role;
