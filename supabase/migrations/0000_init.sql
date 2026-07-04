create table candles (
  id bigint generated always as identity primary key,
  symbol text not null default 'XAU/USD',
  timeframe text not null,
  ts timestamptz not null,
  open numeric(12,4) not null, high numeric(12,4) not null,
  low numeric(12,4) not null, close numeric(12,4) not null,
  volume numeric,
  unique (symbol, timeframe, ts)
);
create index idx_candles_lookup on candles (symbol, timeframe, ts desc);

create table fx_rates (
  id bigint generated always as identity primary key,
  pair text not null default 'GBP/USD',
  rate numeric(12,6) not null,
  ts timestamptz not null default now(),
  unique (pair, ts)
);
create index idx_fx_lookup on fx_rates (pair, ts desc);

create table indicator_snapshots (
  id bigint generated always as identity primary key,
  symbol text not null, timeframe text not null, ts timestamptz not null,
  rsi_14 numeric(8,4), macd numeric(10,5), macd_signal numeric(10,5), macd_hist numeric(10,5),
  ema_20 numeric(12,4), ema_50 numeric(12,4), ema_200 numeric(12,4),
  atr_14 numeric(10,4), nearest_support numeric(12,4), nearest_resistance numeric(12,4),
  created_at timestamptz default now()
);

create table signals (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  symbol text not null default 'XAU/USD',
  timeframe text not null,
  direction text not null check (direction in ('BUY','SELL')),
  entry_price numeric(12,4) not null, stop_loss numeric(12,4) not null, take_profit numeric(12,4) not null,
  rr_ratio numeric(6,2) not null,
  confluence_score int not null, confluence_max int not null default 6,
  track text not null default 'core' check (track in ('core','experimental')),
  factors jsonb not null,
  status text not null default 'OPEN' check (status in ('OPEN','HIT_TP','HIT_SL','EXPIRED','INVALIDATED')),
  resolved_at timestamptz, resolved_price numeric(12,4), pips_result numeric(10,2), notes text,
  suggested_lots numeric(8,2), risk_amount_ccy numeric(12,2), sizing_note text, tp_structure_capped numeric(12,4)
);
create index idx_signals_status on signals (status, created_at desc);

create table performance_daily (
  day date primary key,
  signals_generated int not null default 0, wins int not null default 0,
  losses int not null default 0, expired int not null default 0,
  win_rate numeric(5,2), avg_rr_achieved numeric(6,2), cumulative_r numeric(10,2)
);

create table user_settings (
  id int primary key default 1 check (id = 1),
  account_size numeric(12,2) not null default 2000,
  account_ccy text not null default 'GBP',
  risk_pct numeric(4,2) not null default 1.0 check (risk_pct > 0 and risk_pct <= 3.0),
  current_tier int not null default 1,
  updated_at timestamptz default now()
);
insert into user_settings (id) values (1) on conflict do nothing;

create table system_events (
  id bigint generated always as identity primary key,
  created_at timestamptz default now(),
  level text not null check (level in ('INFO','WARN','ERROR')),
  source text not null, message text not null, meta jsonb
);

alter table candles enable row level security;
alter table fx_rates enable row level security;
alter table indicator_snapshots enable row level security;
alter table signals enable row level security;
alter table performance_daily enable row level security;
alter table user_settings enable row level security;
alter table system_events enable row level security;

create policy "anon read candles" on candles for select to anon using (true);
create policy "anon read signals" on signals for select to anon using (true);
create policy "anon read performance" on performance_daily for select to anon using (true);
-- NO anon policies on fx_rates, indicator_snapshots, user_settings, system_events (RLS on + no policy = deny)

-- Hardening (Supabase-specific): Supabase grants table-level SELECT to the anon
-- and authenticated roles by default, so "RLS on + no policy" would return an
-- empty set rather than a hard error. Revoke those grants on the protected
-- tables so unauthorized reads fail with "permission denied". The backend uses
-- the service_role key, which bypasses both grants and RLS.
revoke all on fx_rates from anon, authenticated;
revoke all on indicator_snapshots from anon, authenticated;
revoke all on user_settings from anon, authenticated;
revoke all on system_events from anon, authenticated;
