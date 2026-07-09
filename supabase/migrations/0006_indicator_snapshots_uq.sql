-- FIX-1 — ADDITIVE: let indicator_snapshots accumulate (one row per closed candle)
-- via UPSERT instead of the old delete+insert. No engine changes.
create unique index if not exists uq_indsnap_sym_tf_ts
  on indicator_snapshots (symbol, timeframe, ts);
