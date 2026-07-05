-- L2-INC-3 — ADDITIVE: execution fill details + reconciliation state. No L1 changes.
alter table positions add column if not exists mode text;
alter table positions add column if not exists timeframe text;
alter table positions add column if not exists close_reason text;
alter table positions add column if not exists realized_r numeric(8,2);
alter table positions add column if not exists slippage_points numeric(10,4);
alter table positions add column if not exists risk_pct_actual numeric(6,4);
alter table positions add column if not exists achieved_rr numeric(6,2);

-- Reconciliation cursor (broker = source of truth). Stored on the account row.
alter table broker_accounts add column if not exists last_transaction_id text;
alter table broker_accounts add column if not exists last_reconciled_at timestamptz;

-- Equity snapshot classification + high-water mark (feeds INC-2 loss/drawdown checks).
alter table equity_snapshots add column if not exists snapshot_type text; -- HOURLY | DAILY_REF | WEEKLY_REF
alter table equity_snapshots add column if not exists high_water_mark numeric(14,2);
