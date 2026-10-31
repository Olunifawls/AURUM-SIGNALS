-- Forward test: the price a signal could really have been taken at. fire_price is
-- the executor's side of a live quote (ask for BUY, bid for SELL) from evaluation
-- time, or the last closed 15min candle (a mid price) when there was no quote and
-- for the rows backfilled here. L1 outcomes on signals are not changed. Needs 0011.
alter table signal_evaluations
  add column if not exists fired_at timestamptz,
  add column if not exists fire_price numeric(12,4),
  add column if not exists fire_price_source text check (fire_price_source in ('QUOTE','CANDLE'));

update signal_evaluations e
set fired_at = s.created_at,
    fire_price = c.close,
    fire_price_source = case when c.close is null then null else 'CANDLE' end
from signals s
left join lateral (
  select close from candles
  where symbol = s.symbol and timeframe = '15min' and ts + interval '15 minutes' <= s.created_at
  order by ts desc
  limit 1
) c on true
where s.id = e.signal_id and e.fired_at is null;
