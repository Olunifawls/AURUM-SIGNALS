import { Decision, OrderIntent, RejectReason, RiskContext, RiskEvent } from './risk.types';
import { computeSizing, exceedsAbsoluteCeiling } from './sizing';

function severityFor(reason: RejectReason): 'WARN' | 'CRITICAL' {
  return reason === 'DAILY_LOSS_HALT' || reason === 'WEEKLY_LOSS_HALT' || reason === 'DRAWDOWN_HALT'
    ? 'CRITICAL'
    : 'WARN';
}

/** Loss limits (check 6, roadmap D4/B3/D6). Uses fresh equity incl. unrealised. */
function lossLimit(ctx: RiskContext): { reason: RejectReason; message: string; meta: Record<string, unknown> } | null {
  const daily =
    ctx.referenceEquityDaily && ctx.referenceEquityDaily > 0
      ? ((ctx.referenceEquityDaily - ctx.equity) / ctx.referenceEquityDaily) * 100
      : 0;
  const weekly =
    ctx.referenceEquityWeekly && ctx.referenceEquityWeekly > 0
      ? ((ctx.referenceEquityWeekly - ctx.equity) / ctx.referenceEquityWeekly) * 100
      : 0;
  const drawdown =
    ctx.highWaterMark && ctx.highWaterMark > 0
      ? ((ctx.highWaterMark - ctx.equity) / ctx.highWaterMark) * 100
      : 0;

  if (daily >= ctx.maxDailyLossPct) {
    return { reason: 'DAILY_LOSS_HALT', message: `daily loss ${daily.toFixed(2)}% >= ${ctx.maxDailyLossPct}%`, meta: { daily } };
  }
  if (weekly >= ctx.maxWeeklyLossPct) {
    return { reason: 'WEEKLY_LOSS_HALT', message: `weekly loss ${weekly.toFixed(2)}% >= ${ctx.maxWeeklyLossPct}%`, meta: { weekly } };
  }
  if (drawdown >= ctx.maxTotalDrawdownPct) {
    return { reason: 'DRAWDOWN_HALT', message: `drawdown ${drawdown.toFixed(2)}% >= ${ctx.maxTotalDrawdownPct}%`, meta: { drawdown } };
  }
  return null;
}

/**
 * Run the nine pre-trade checks IN ORDER (spec §5.2). Pure — all I/O is already
 * gathered into `ctx`. Returns the first rejection (+ its risk_event) or, if all
 * pass, the approval with sizing. Non-fatal warnings (TIER2_CLAMPED, degraded
 * news coverage) are accumulated into `events` regardless.
 */
export function evaluateOrder(intent: OrderIntent, ctx: RiskContext): Decision {
  const events: RiskEvent[] = [];
  const reject = (reason: RejectReason, message: string, meta?: Record<string, unknown>): Decision => ({
    approved: false,
    reason,
    events: [...events, { event_type: reason, severity: severityFor(reason), message, meta }],
  });

  // 1) auto-trade enabled + no halt
  if (!ctx.autoTradeEnabled) return reject('AUTO_TRADE_DISABLED', 'AUTO_TRADE_ENABLED is false');
  if (ctx.halted) return reject('TRADING_HALTED', 'an active halt flag is set');

  // 2) live-mode gate (D10 — hard-coded, cannot be config-bypassed)
  if (ctx.mode === 'live' && ctx.resolvedDemoTrades < 30) {
    return reject('LIVE_GATE_BLOCKED', `live mode requires >=30 resolved demo trades (have ${ctx.resolvedDemoTrades})`);
  }

  // 3) session timing
  if (!ctx.session.marketOpen) return reject('MARKET_CLOSED', 'gold market is closed');
  if (ctx.session.inFirstWindow) return reject('SESSION_WINDOW', 'within first 2h after weekly open');
  if (ctx.session.inLastWindow) return reject('SESSION_WINDOW', 'within last 2h before weekly close');

  // 4) news blackout (flag degraded coverage regardless of outcome)
  if (ctx.news.degraded) {
    events.push({
      event_type: 'NEWS_COVERAGE_DEGRADED',
      severity: 'WARN',
      message: `news blackout coverage degraded (source=${ctx.news.source}; no live API). Admin alert deferred to INC-4.`,
    });
  }
  if (ctx.news.inBlackout) return reject('NEWS_BLACKOUT', 'high-impact USD news blackout window');

  // 4a) volatility cooldown (read-only flag; trigger logic is INC-4)
  if (ctx.volatilityCooldown) return reject('VOLATILITY_COOLDOWN', 'volatility cooldown active');

  // 5) exposure (D9 — live broker state)
  if (ctx.brokerOpenTradeCount >= ctx.maxOpenPositions) {
    return reject('MAX_POSITIONS', `open trades ${ctx.brokerOpenTradeCount} >= MAX_OPEN_POSITIONS ${ctx.maxOpenPositions}`);
  }
  if (ctx.existingOpenSameDirTf) {
    return reject('DUPLICATE_EXPOSURE', `already an open ${intent.side} position on ${intent.timeframe}`);
  }

  // 6) loss limits
  const loss = lossLimit(ctx);
  if (loss) return reject(loss.reason, loss.message, loss.meta);

  // 7) spread
  if (ctx.spreadPoints > ctx.maxSpreadPoints) {
    return reject('SPREAD_TOO_WIDE', `spread ${ctx.spreadPoints} > MAX_SPREAD_POINTS ${ctx.maxSpreadPoints}`);
  }

  // --- sizing computed here (needed for the margin check) ---
  const stopDistanceUsd = Math.abs(intent.entryPrice - intent.stopLoss);
  const { sizing, tierEvent } = computeSizing({
    equity: ctx.equity,
    accountCcy: ctx.accountCcy,
    gbpUsdRate: ctx.gbpUsdRate,
    riskPct: ctx.riskPerTradePct,
    stopDistanceUsd,
    maxSlippagePoints: ctx.maxSlippagePoints,
    minTradeSize: ctx.minTradeSize,
    tier2Unlocked: ctx.tier2Unlocked,
    requestedEntry: intent.entryPrice,
    stopLoss: intent.stopLoss,
    takeProfit: intent.takeProfit,
  });
  if (tierEvent) events.push(tierEvent);

  // 9a) minimum trade size — never tighten the stop to force a trade
  if (sizing.units < ctx.minTradeSize) {
    return reject('EXPOSURE_BLOCK', `computed size ${sizing.units} < min ${ctx.minTradeSize}; not tightening the stop`, {
      units: sizing.units,
    });
  }

  // 8) margin (projected post-trade usage <= 40% of equity)
  const newMarginUsd = sizing.units * ctx.price * ctx.marginRate;
  const newMarginCcy = ctx.accountCcy === 'GBP' ? newMarginUsd / ctx.gbpUsdRate : newMarginUsd;
  const projectedMargin = ctx.marginUsed + newMarginCcy;
  if (projectedMargin > 0.4 * ctx.equity) {
    return reject('MARGIN_EXCEEDED', `projected margin ${projectedMargin.toFixed(2)} > 40% of equity ${ctx.equity}`, {
      projectedMargin,
    });
  }

  // 9b) absolute-ceiling backstop
  if (exceedsAbsoluteCeiling(sizing.worstCasePct)) {
    return reject('TIER_CEILING_EXCEEDED', `worst-case risk ${sizing.worstCasePct.toFixed(2)}% exceeds 3.0% ceiling`, {
      worstCasePct: sizing.worstCasePct,
    });
  }

  return { approved: true, events, sizing };
}
