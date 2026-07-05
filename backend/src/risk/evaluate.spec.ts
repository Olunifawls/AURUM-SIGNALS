import { evaluateOrder } from './evaluate';
import { OrderIntent, RiskContext } from './risk.types';

const intent: OrderIntent = { signalId: 'sig-1', side: 'BUY', timeframe: '4h', entryPrice: 2000, stopLoss: 1991.6, takeProfit: 2016.8 };

function passing(): RiskContext {
  return {
    now: new Date('2026-07-08T12:00:00Z'),
    mode: 'demo',
    autoTradeEnabled: true,
    halted: false,
    resolvedDemoTrades: 100,
    session: { marketOpen: true, inFirstWindow: false, inLastWindow: false },
    news: { inBlackout: false, degraded: true, source: 'fallback' },
    volatilityCooldown: false,
    brokerOpenTradeCount: 0,
    existingOpenSameDirTf: false,
    maxOpenPositions: 2,
    equity: 2000,
    accountCcy: 'GBP',
    gbpUsdRate: 1.25,
    referenceEquityDaily: 2000,
    referenceEquityWeekly: 2000,
    highWaterMark: 2000,
    maxDailyLossPct: 3,
    maxWeeklyLossPct: 6,
    maxTotalDrawdownPct: 20,
    spreadPoints: 0.3,
    maxSpreadPoints: 0.6,
    marginUsed: 0,
    marginRate: 0.05,
    price: 2000,
    riskPerTradePct: 1.0,
    maxSlippagePoints: 0.5,
    minTradeSize: 0.1,
    tier2Unlocked: false,
  };
}

describe('evaluateOrder — the passing baseline approves', () => {
  it('approves a clean order with correct sizing', () => {
    const d = evaluateOrder(intent, passing());
    expect(d.approved).toBe(true);
    expect(d.sizing?.units).toBeCloseTo(2.8, 6);
  });
});

describe('(a) NINE-CHECK REJECTIONS — violate only one check, assert reason + risk_event', () => {
  const cases: Array<[string, Partial<RiskContext>, string]> = [
    ['1 auto-trade off', { autoTradeEnabled: false }, 'AUTO_TRADE_DISABLED'],
    ['1 halted', { halted: true }, 'TRADING_HALTED'],
    ['2 live gate', { mode: 'live', resolvedDemoTrades: 10 }, 'LIVE_GATE_BLOCKED'],
    ['3 market closed', { session: { marketOpen: false, inFirstWindow: false, inLastWindow: false } }, 'MARKET_CLOSED'],
    ['3 first window', { session: { marketOpen: true, inFirstWindow: true, inLastWindow: false } }, 'SESSION_WINDOW'],
    ['3 last window', { session: { marketOpen: true, inFirstWindow: false, inLastWindow: true } }, 'SESSION_WINDOW'],
    ['4 news blackout', { news: { inBlackout: true, degraded: true, source: 'fallback' } }, 'NEWS_BLACKOUT'],
    ['4a volatility', { volatilityCooldown: true }, 'VOLATILITY_COOLDOWN'],
    ['5 max positions', { brokerOpenTradeCount: 2 }, 'MAX_POSITIONS'],
    ['5 duplicate', { existingOpenSameDirTf: true }, 'DUPLICATE_EXPOSURE'],
    ['6 daily loss', { referenceEquityDaily: 2000, equity: 1900 }, 'DAILY_LOSS_HALT'],
    ['6 weekly loss', { referenceEquityDaily: 1930, referenceEquityWeekly: 2100, equity: 1900 }, 'WEEKLY_LOSS_HALT'],
    ['6 drawdown', { referenceEquityDaily: 1900, referenceEquityWeekly: 1900, highWaterMark: 2500, equity: 1900 }, 'DRAWDOWN_HALT'],
    ['7 spread', { spreadPoints: 0.7 }, 'SPREAD_TOO_WIDE'],
    ['8 margin', { marginUsed: 790 }, 'MARGIN_EXCEEDED'],
  ];

  it.each(cases)('%s -> %s', (_name, override, reason) => {
    const d = evaluateOrder(intent, { ...passing(), ...override } as RiskContext);
    expect(d.approved).toBe(false);
    expect(d.reason).toBe(reason);
    expect(d.events.some((e) => e.event_type === reason)).toBe(true); // logged to risk_events
  });
});

describe('(b) LIVE-GATE cannot be config-bypassed', () => {
  it('live mode with <30 resolved demo trades is rejected regardless of other config being permissive', () => {
    const ctx = { ...passing(), mode: 'live' as const, resolvedDemoTrades: 29, autoTradeEnabled: true };
    const d = evaluateOrder(intent, ctx);
    expect(d.reason).toBe('LIVE_GATE_BLOCKED');
  });
  it('30 resolved demo trades clears the gate', () => {
    const ctx = { ...passing(), mode: 'live' as const, resolvedDemoTrades: 30 };
    const d = evaluateOrder(intent, ctx);
    expect(d.reason).not.toBe('LIVE_GATE_BLOCKED');
  });
});

describe('(e) EXPOSURE_BLOCK — units < 0.1, stop unchanged', () => {
  it('a very wide stop blocks the trade without tightening the stop', () => {
    const wide: OrderIntent = { ...intent, stopLoss: 1000 }; // stop distance 1000
    const d = evaluateOrder(wide, { ...passing(), equity: 2000 });
    expect(d.reason).toBe('EXPOSURE_BLOCK');
    expect(wide.stopLoss).toBe(1000); // intent not mutated
  });
});

describe('(d) absolute-ceiling backstop rejects worst-case > 3%', () => {
  it('mis-set 3.5% risk on unlocked Tier 2 is rejected by the backstop', () => {
    const d = evaluateOrder(intent, { ...passing(), riskPerTradePct: 3.5, tier2Unlocked: true });
    expect(d.reason).toBe('TIER_CEILING_EXCEEDED');
  });
});
