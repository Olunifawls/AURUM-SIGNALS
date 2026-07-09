-- FIX-2 — one-shot admin reset: atomically wipes the contaminated trading
-- ledger and clears active halts. Called by POST /api/admin/ledger-reset
-- (AdminTokenGuard) from the backend; never from anon/authenticated clients.
-- NEVER touches clean-data tables: candles, fx_rates, indicator_snapshots,
-- broker_accounts, user_settings, system_events, system_halts (rows are
-- soft-cleared, not deleted).

create or replace function reset_demo_ledger()
returns jsonb
language plpgsql
security definer  -- runs as owner (postgres) to bypass RLS on protected tables
as $$
declare
  n_risk      int := 0;
  n_equity    int := 0;
  n_positions int := 0;
  n_orders    int := 0;
  n_signals   int := 0;
  n_perf      int := 0;
  n_halts     int := 0;
begin
  -- Delete in FK-safe order (leaf tables first; all FKs are ON DELETE SET NULL
  -- so order doesn't strictly matter, but this is clearest):
  delete from risk_events;          get diagnostics n_risk      = row_count;
  delete from equity_snapshots;     get diagnostics n_equity    = row_count;
  delete from positions;            get diagnostics n_positions = row_count;
  delete from orders;               get diagnostics n_orders    = row_count;
  delete from signals;              get diagnostics n_signals   = row_count;
  delete from performance_daily;    get diagnostics n_perf      = row_count;

  -- Soft-clear active halts (preserve audit rows, just deactivate).
  update system_halts
     set active     = false,
         cleared_at = now(),
         updated_at = now()
   where active = true;
  get diagnostics n_halts = row_count;

  return jsonb_build_object(
    'risk_events',       n_risk,
    'equity_snapshots',  n_equity,
    'positions',         n_positions,
    'orders',            n_orders,
    'signals',           n_signals,
    'performance_daily', n_perf,
    'halts_cleared',     n_halts
  );
end;
$$;

-- Only the service_role (backend) may call this. Anon/authenticated are denied.
revoke all on function reset_demo_ledger() from anon, authenticated;
grant  execute on function reset_demo_ledger() to service_role;
