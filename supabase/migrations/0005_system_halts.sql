-- L2-INC-4 — ADDITIVE: persistent kill-switch / circuit-breaker state.
-- One row per halt type; halts survive restarts. Backend-only (RLS, no anon).
create table if not exists system_halts (
  id uuid primary key default gen_random_uuid(),
  halt_type text not null unique,
  active boolean not null default true,
  scope text not null default 'NEW_ORDERS', -- NEW_ORDERS | ALL
  reason text,
  requires_manual boolean not null default false,
  triggered_at timestamptz not null default now(),
  clears_at timestamptz,      -- timed auto-clear (volatility, session-gap, loss rollovers)
  cleared_at timestamptz,
  meta jsonb,
  updated_at timestamptz not null default now()
);

alter table system_halts enable row level security;
revoke all on system_halts from anon, authenticated;
