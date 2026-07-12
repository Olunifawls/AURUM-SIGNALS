-- L2-INC-R ADDITIVE: persist the original stop loss on each position.
-- R must always be measured against the initial risk at entry, not the current
-- (possibly breakeven-moved) stop. Without this column, a position whose SL was
-- moved to entry+buffer produces |entry - stop| ≈ 0, blowing up realized_r to
-- hundreds of R for normal TP outcomes.
-- The breakeven-stop service already writes meta.originalSL when it moves the SL;
-- this column is the canonical persisted version so application code never has to
-- parse JSON.
ALTER TABLE positions ADD COLUMN IF NOT EXISTS initial_stop_loss numeric(12,4);
