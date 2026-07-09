/**
 * Level 2 (automated execution) configuration — reads env only. NO broker calls,
 * NO risk/execution logic here; this just surfaces the L2 config (spec §3) for
 * later increments and the demo broker-account seed.
 */
export type TradingMode = 'demo' | 'live';

function str(v: string | undefined): string | undefined {
  const t = (v ?? '').trim();
  return t.length ? t : undefined;
}

function num(v: string | undefined, fallback: number): number {
  const n = v != null ? Number(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

function bool(v: string | undefined, fallback: boolean): boolean {
  if (v == null) return fallback;
  return v.trim().toLowerCase() === 'true';
}

export interface Level2Config {
  tradingMode: TradingMode;
  demo: { accountId?: string; accountCcy: string };
  live: { accountId?: string; accountCcy?: string };
  riskPerTradePct: number;
  maxOpenPositions: number;
  maxDailyLossPct: number;
  maxWeeklyLossPct: number;
  maxTotalDrawdownPct: number;
  maxSpreadPoints: number;
  maxSlippagePoints: number;
  newsBlackoutEnabled: boolean;
  autoTradeEnabled: boolean;
  breakevenStopEnabled: boolean;
  breakevenBufferPoints: number;
}

export function level2Config(): Level2Config {
  const mode = str(process.env.TRADING_MODE) === 'live' ? 'live' : 'demo';
  return {
    tradingMode: mode,
    demo: {
      accountId: str(process.env.OANDA_ACCOUNT_ID_DEMO),
      accountCcy: str(process.env.OANDA_ACCOUNT_CCY_DEMO) ?? 'GBP',
    },
    live: {
      accountId: str(process.env.OANDA_ACCOUNT_ID_LIVE),
      accountCcy: str(process.env.OANDA_ACCOUNT_CCY_LIVE),
    },
    riskPerTradePct: num(process.env.RISK_PER_TRADE_PCT, 1.0),
    maxOpenPositions: num(process.env.MAX_OPEN_POSITIONS, 2),
    maxDailyLossPct: num(process.env.MAX_DAILY_LOSS_PCT, 3.0),
    maxWeeklyLossPct: num(process.env.MAX_WEEKLY_LOSS_PCT, 6.0),
    maxTotalDrawdownPct: num(process.env.MAX_TOTAL_DRAWDOWN_PCT, 20),
    maxSpreadPoints: num(process.env.MAX_SPREAD_POINTS, 0.6),
    maxSlippagePoints: num(process.env.MAX_SLIPPAGE_POINTS, 0.5),
    newsBlackoutEnabled: bool(process.env.NEWS_BLACKOUT_ENABLED, true),
    autoTradeEnabled: bool(process.env.AUTO_TRADE_ENABLED, true),
    breakevenStopEnabled: bool(process.env.BREAKEVEN_STOP_ENABLED, false),
    breakevenBufferPoints: num(process.env.BREAKEVEN_BUFFER_POINTS, 0.1),
  };
}
