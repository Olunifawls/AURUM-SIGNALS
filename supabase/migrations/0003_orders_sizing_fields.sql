-- L2-INC-2 — ADDITIVE: sizing fields the risk manager computes for an order
-- (persisted by the INC-3 place flow). No L1 changes; no order placement here.
alter table orders add column if not exists equity_at_entry numeric(14,2);
alter table orders add column if not exists risk_ccy numeric(14,2);
alter table orders add column if not exists risk_pct_actual numeric(6,4);
