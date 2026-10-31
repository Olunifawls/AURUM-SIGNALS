-- One row per weekly report: the frozen numbers behind it. Backend-only.
create table if not exists weekly_snapshots (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  ruleset text not null,
  payload jsonb not null
);
create index if not exists idx_weekly_snapshots_created on weekly_snapshots (created_at desc);

alter table weekly_snapshots enable row level security;
revoke all on weekly_snapshots from anon, authenticated;
