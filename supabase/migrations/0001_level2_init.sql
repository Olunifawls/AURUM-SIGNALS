-- Level 2 (automated execution) — ADDITIVE migration.
-- Creates 5 new tables + the active-order idempotency guard + RLS lockdown.
-- Does NOT alter, drop, or touch any Level 1 table or data.
-- (Column set follows the L2 spec §4; roadmap hooks noted inline.)

-- 1) Broker accounts (OANDA demo/live). account_ref (the real account id) is
--    seeded from env at backend startup — never hard-coded here.
create table broker_accounts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  broker text not null default 'OANDA',
  mode text not null check (mode in ('demo','live')),
  account_ref text not null,
  base_currency text not null check (base_currency in ('GBP','USD')), -- roadmap D11
  is_active boolean not null default true,
  updated_at timestamptz not null default now(),
  unique (broker, mode, account_ref)
);

-- 2) Orders placed (or intended) against a broker account, tied to an L1 signal.
create table orders (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  signal_id uuid references signals (id) on delete set null,
  broker_account_id uuid references broker_accounts (id) on delete set null,
  mode text not null check (mode in ('demo','live')),
  instrument text not null default 'XAU/USD',
  side text not null check (side in ('BUY','SELL')),
  units numeric(14,2),
  requested_price numeric(12,4),
  stop_loss numeric(12,4),
  take_profit numeric(12,4),
  status text not null default 'PENDING'
    check (status in ('PENDING','SUBMITTED','FILLED','REJECTED','CANCELLED','ERROR')),
  broker_order_id text,
  filled_price numeric(12,4),
  filled_at timestamptz,
  reason text,
  meta jsonb,
  updated_at timestamptz not null default now()
);
create index idx_orders_signal on orders (signal_id);
create index idx_orders_status on orders (status, created_at desc);

-- Idempotency guard (roadmap D2/B1): a signal can have at most ONE active order.
create unique index uq_orders_active_signal
  on orders (signal_id)
  where status in ('PENDING','SUBMITTED','FILLED');

-- 3) Open/closed positions resulting from filled orders.
create table positions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  broker_account_id uuid references broker_accounts (id) on delete set null,
  order_id uuid references orders (id) on delete set null,
  signal_id uuid references signals (id) on delete set null,
  instrument text not null default 'XAU/USD',
  side text not null check (side in ('BUY','SELL')),
  units numeric(14,2),
  entry_price numeric(12,4),
  stop_loss numeric(12,4),
  take_profit numeric(12,4),
  status text not null default 'OPEN' check (status in ('OPEN','CLOSED')),
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  close_price numeric(12,4),
  realized_pl numeric(14,2),
  realized_pl_ccy text,
  broker_trade_id text,
  meta jsonb,
  updated_at timestamptz not null default now()
);
create index idx_positions_status on positions (status, opened_at desc);

-- 4) Risk events (halts, blocks, kill-switch, drawdown — roadmap D6/B5). Log only here.
create table risk_events (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  mode text,
  event_type text not null,
  severity text not null default 'INFO' check (severity in ('INFO','WARN','CRITICAL')),
  signal_id uuid references signals (id) on delete set null,
  order_id uuid references orders (id) on delete set null,
  message text not null,
  meta jsonb
);
create index idx_risk_events_lookup on risk_events (event_type, created_at desc);

-- 5) Equity snapshots for the drawdown/PL curve.
create table equity_snapshots (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  broker_account_id uuid references broker_accounts (id) on delete set null,
  mode text,
  balance numeric(14,2),
  equity numeric(14,2),
  unrealized_pl numeric(14,2),
  realized_pl_day numeric(14,2),
  open_positions int,
  drawdown_pct numeric(6,2),
  ts timestamptz not null default now(),
  meta jsonb
);
create index idx_equity_snapshots_ts on equity_snapshots (ts desc);

-- RLS: backend-only. Enable RLS and revoke all grants from anon/authenticated
-- (Supabase grants SELECT to those roles by default). No anon policies.
alter table broker_accounts enable row level security;
alter table orders enable row level security;
alter table positions enable row level security;
alter table risk_events enable row level security;
alter table equity_snapshots enable row level security;

revoke all on broker_accounts from anon, authenticated;
revoke all on orders from anon, authenticated;
revoke all on positions from anon, authenticated;
revoke all on risk_events from anon, authenticated;
revoke all on equity_snapshots from anon, authenticated;
