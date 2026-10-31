-- Ruleset v1: L1 can record one setup more than once. A repeat keeps its evaluation
-- and points at the earliest signal of that setup. Apply before deploying the code
-- that reads this column. Needs 0011. No backfill: repeats are marked as they arrive.
alter table signal_evaluations
  add column if not exists duplicate_of uuid references signals (id) on delete set null;
