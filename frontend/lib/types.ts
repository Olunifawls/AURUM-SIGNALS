export type Direction = 'BUY' | 'SELL';
export type SignalStatus = 'OPEN' | 'HIT_TP' | 'HIT_SL' | 'EXPIRED' | 'INVALIDATED';
export type Timeframe = '15min' | '1h' | '4h' | '1day';
export const TIMEFRAMES: Timeframe[] = ['15min', '1h', '4h', '1day'];

export interface FactorDetail {
  pass: boolean;
  [k: string]: unknown;
}

export interface SignalRow {
  id: string;
  created_at: string;
  symbol: string;
  timeframe: Timeframe;
  direction: Direction;
  entry_price: string | number;
  stop_loss: string | number;
  take_profit: string | number;
  rr_ratio: string | number;
  confluence_score: number;
  confluence_max: number;
  track: 'core' | 'experimental';
  status: SignalStatus;
  resolved_at: string | null;
  resolved_price: string | number | null;
  pips_result: string | number | null;
  suggested_lots: string | number | null;
  risk_amount_ccy: string | number | null;
  sizing_note: string | null;
  tp_structure_capped: string | number | null;
  factors: Record<string, FactorDetail> | null;
  notes: string | null;
}

export interface PerformanceHeadline {
  total_signals: number;
  resolved: number;
  wins: number;
  losses: number;
  expired: number;
  win_rate: number | null;
  avg_r_per_trade: number | null;
  cumulative_r: number;
  max_losing_streak: number;
}

export interface PerformanceResponse {
  daily: Array<{
    day: string;
    signals_generated: number;
    wins: number;
    losses: number;
    expired: number;
    win_rate: number | null;
    avg_rr_achieved: number | null;
    cumulative_r: number;
  }>;
  headline: PerformanceHeadline; // core track ONLY
  experimental: PerformanceHeadline; // track='experimental'
  note: string;
}

export interface Settings {
  account_size: number;
  account_ccy: string;
  risk_pct: number;
  current_tier: number;
}

export interface IndicatorSnapshot {
  timeframe: string;
  ts: string;
  rsi_14: string | number | null;
  macd: string | number | null;
  ema_20: string | number | null;
  ema_50: string | number | null;
  ema_200: string | number | null;
  atr_14: string | number | null;
  nearest_support: string | number | null;
  nearest_resistance: string | number | null;
}

export interface MarketSnapshot {
  symbol: string;
  price: { value: number; ts: string } | null;
  indicators: Record<string, IndicatorSnapshot | null>;
  fx: { pair: string; rate: number; ts: string } | null;
  dataAsOf: string | null;
  note: string;
}

export interface HealthResponse {
  ts: string;
  marketOpen: boolean;
  stale: boolean;
  staleThresholdMinutes: number;
  timeframes: Record<string, { lastIngestionTs: string | null }>;
  fx: { lastTs: string | null };
  sources: Record<string, { consecutiveErrors: number; circuitOpen: boolean }>;
}

export interface TierStatus {
  resolved_count: number;
  cumulative_r: number;
  tier2_unlocked: boolean;
  progress: string;
}

export interface Candle {
  ts: string;
  open: number;
  high: number;
  low: number;
  close: number;
}
