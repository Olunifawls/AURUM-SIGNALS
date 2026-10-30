-- Ruleset v1: the news exit is SHADOW. Each tier-1 release logs one row per open
-- position with the price it would have closed at. Apply after 0011.
alter table trade_watch_events drop constraint if exists trade_watch_events_kind_check;
alter table trade_watch_events add constraint trade_watch_events_kind_check
  check (kind in ('THESIS_CHECK','DOLLAR_SHOCK','NEWS_EXIT_SHADOW'));
