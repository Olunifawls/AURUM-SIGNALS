export type Side = 'BUY' | 'SELL';
export type TradingMode = 'demo' | 'live';

export type RejectReason =
  | 'AUTO_TRADE_DISABLED'
  | 'TRADING_HALTED'
  | 'LIVE_GATE_BLOCKED'
  | 'MARKET_CLOSED'
  | 'SESSION_WINDOW'
  | 'NEWS_BLACKOUT'
  | 'VOLATILITY_COOLDOWN'
  | 'MAX_POSITIONS'
  | 'DUPLICATE_EXPOSURE'
  | 'DAILY_LOSS_HALT'
  | 'WEEKLY_LOSS_HALT'
  | 'DRAWDOWN_HALT'
  | 'SPREAD_TOO_WIDE'
  | 'MARGIN_EXCEEDED'
  | 'EXPOSURE_BLOCK'
  | 'TIER_CEILING_EXCEEDED';

export type EventSeverity = 'INFO' | 'WARN' | 'CRITICAL';

export interface RiskEvent {
  event_type: RejectReason | 'TIER2_CLAMPED' | 'NEWS_COVERAGE_DEGRADED';
  severity: EventSeverity;
  message: string;
  meta?: Record<string, unknown>;
}

export interface OrderIntent {
  signalId: string;
  side: Side;
  timeframe: string;
  entryPrice: number; // requested entry
  stopLoss: number;
  takeProfit: number;
}

export interface RiskContext {
  now: Date;
  mode: TradingMode;
  // check 1
  autoTradeEnabled: boolean;
  halted: boolean;
  // check 2
  resolvedDemoTrades: number;
  // check 3 (precomputed session flags, see session.ts)
  session: { marketOpen: boolean; inFirstWindow: boolean; inLastWindow: boolean };
  // check 4
  news: { inBlackout: boolean; degraded: boolean; source: string };
  // check 4a
  volatilityCooldown: boolean;
  // check 5 (live broker state — D9)
  brokerOpenTradeCount: number;
  existingOpenSameDirTf: boolean;
  maxOpenPositions: number;
  // check 6 (loss limits)
  equity: number; // FRESH from broker, account ccy
  accountCcy: 'GBP' | 'USD';
  gbpUsdRate: number;
  referenceEquityDaily: number | null;
  referenceEquityWeekly: number | null;
  highWaterMark: number | null;
  maxDailyLossPct: number;
  maxWeeklyLossPct: number;
  maxTotalDrawdownPct: number;
  // check 7
  spreadPoints: number;
  maxSpreadPoints: number;
  // check 8 (margin)
  marginUsed: number; // account ccy
  marginRate: number;
  price: number; // XAU_USD price (USD) for notional
  // check 9 (sizing)
  riskPerTradePct: number;
  maxSlippagePoints: number;
  minTradeSize: number; // 0.1
  tier2Unlocked: boolean;
}

export interface SizingResult {
  units: number;
  equityAtEntry: number;
  riskCcy: number;
  riskUsd: number;
  riskPctActual: number; // worst-case % of equity actually risked
  worstCaseUsd: number;
  worstCasePct: number;
  effectiveRiskPct: number;
  clamped: boolean;
  requestedEntry: number;
  stopLoss: number;
  takeProfit: number;
}

export interface Decision {
  approved: boolean;
  reason?: RejectReason;
  events: RiskEvent[];
  sizing?: SizingResult;
}
