-- Analytics: path metrics for resolved L1 signals.
-- Stores MFE, MAE, and R-crossing timestamps computed from 15min candles.
-- Research-only — never read by live trading logic.

CREATE TABLE IF NOT EXISTS signal_path_metrics (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id       uuid NOT NULL REFERENCES signals(id) ON DELETE CASCADE,
  direction       text NOT NULL,
  entry_price     numeric(12,4) NOT NULL,
  initial_sl      numeric(12,4) NOT NULL,
  take_profit     numeric(12,4) NOT NULL,
  mfe_r           numeric(8,4)  NOT NULL DEFAULT 0,
  mae_r           numeric(8,4)  NOT NULL DEFAULT 0,
  cross_0_5r_ts   timestamptz,
  cross_1r_ts     timestamptz,
  cross_1_5r_ts   timestamptz,
  cross_2r_ts     timestamptz,
  -- After first reaching +1R, did price fall to ≤ 0R before reaching +1.5R?
  -- null = never reached +1R.
  retraced_from_1r    boolean,
  -- After first reaching +1.5R, did price fall to ≤ +1R before reaching +2R?
  -- null = never reached +1.5R.
  retraced_from_1_5r  boolean,
  candles_in_path int NOT NULL DEFAULT 0,
  computed_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (signal_id)
);

ALTER TABLE signal_path_metrics ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON signal_path_metrics FROM anon, authenticated;
GRANT ALL ON signal_path_metrics TO service_role;
