-- FIX-L2-6 — ADDITIVE: the admin reset and purge archive history instead of
-- destroying it. Every removed row is copied to ledger_archive first, in the same
-- transaction, so a failure part-way leaves the ledger exactly as it was.
--
-- One table of jsonb rows rather than a *_archive copy per table: the archive
-- cannot drift when a live table gains a column. To read rows back:
--   select r.* from ledger_archive a,
--     jsonb_populate_record(null::positions, a.row_data) r
--   where a.source_table = 'positions' and a.batch_id = '...';
--
-- signal_path_metrics is included because it cascades from signals. A signals
-- wipe silently destroys it otherwise.

create table if not exists ledger_archive (
  id bigint generated always as identity primary key,
  archived_at timestamptz not null default now(),
  batch_id uuid not null,        -- one per reset/purge call
  reason text not null,          -- ledger-reset | purge-test-artifacts
  source_table text not null,
  source_id text not null,       -- the row's primary key, as text
  row_data jsonb not null
);
create index if not exists idx_ledger_archive_batch on ledger_archive (batch_id);
create index if not exists idx_ledger_archive_source on ledger_archive (source_table, archived_at desc);

alter table ledger_archive enable row level security;
revoke all on ledger_archive from anon, authenticated;

-- Superseded by archive_and_wipe_ledger. Nothing calls it, and it destroys rows.
drop function if exists reset_demo_ledger();

-- Each delete below says "where true": Supabase rejects a DELETE with no WHERE
-- clause on API connections, which is how these functions are called.

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
    'equity_snapshots',    n_equity,
    'positions',           n_positions,
    'orders',              n_orders,
    'signals',             n_signals,
    'performance_daily',   n_perf
  );
end;
$$;

create or replace function archive_test_artifacts(
  p_reason text,
  p_position_ids uuid[],
  p_order_ids uuid[]
)
returns jsonb
language plpgsql
security definer  -- runs as owner to bypass RLS on protected tables
set search_path = public
as $$
declare
  v_batch      uuid := gen_random_uuid();
  n_positions  int := 0;
  n_orders     int := 0;
  n_risk       int := 0;
  n_perf       int := 0;
begin
  insert into ledger_archive (batch_id, reason, source_table, source_id, row_data)
    select v_batch, p_reason, 'positions', t.id::text, to_jsonb(t)
      from positions t where t.id = any(p_position_ids);
  delete from positions where id = any(p_position_ids);
  get diagnostics n_positions = row_count;

  insert into ledger_archive (batch_id, reason, source_table, source_id, row_data)
    select v_batch, p_reason, 'orders', t.id::text, to_jsonb(t)
      from orders t where t.id = any(p_order_ids);
  delete from orders where id = any(p_order_ids);
  get diagnostics n_orders = row_count;

  insert into ledger_archive (batch_id, reason, source_table, source_id, row_data)
    select v_batch, p_reason, 'risk_events', t.id::text, to_jsonb(t) from risk_events t;
  delete from risk_events where true;
  get diagnostics n_risk = row_count;

  insert into ledger_archive (batch_id, reason, source_table, source_id, row_data)
    select v_batch, p_reason, 'performance_daily', t.day::text, to_jsonb(t) from performance_daily t;
  delete from performance_daily where true;
  get diagnostics n_perf = row_count;

  return jsonb_build_object(
    'batch_id',          v_batch,
    'positions',         n_positions,
    'orders',            n_orders,
    'risk_events',       n_risk,
    'performance_daily', n_perf
  );
end;
$$;

-- Only the service_role (backend) may call these. Functions are executable by
-- PUBLIC by default, so PUBLIC has to be revoked too.
revoke all on function archive_and_wipe_ledger(text) from public, anon, authenticated;
grant execute on function archive_and_wipe_ledger(text) to service_role;
revoke all on function archive_test_artifacts(text, uuid[], uuid[]) from public, anon, authenticated;
grant execute on function archive_test_artifacts(text, uuid[], uuid[]) to service_role;
