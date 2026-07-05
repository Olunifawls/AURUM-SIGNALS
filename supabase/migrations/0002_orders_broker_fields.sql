-- L2-INC-1 — ADDITIVE: columns the OANDA place flow records. No L1 changes.
alter table orders add column if not exists broker_trade_id text;
alter table orders add column if not exists client_tag text; -- 'aurum-{signal_id}' reconciliation tag
create index if not exists idx_orders_client_tag on orders (client_tag);
