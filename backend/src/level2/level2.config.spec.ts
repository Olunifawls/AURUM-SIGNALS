import { level2Config } from './level2.config';

describe('level2Config', () => {
  const OLD = { ...process.env };
  afterEach(() => {
    process.env = { ...OLD };
  });

  it('uses sensible defaults when L2 env is unset', () => {
    for (const k of [
      'TRADING_MODE', 'OANDA_ACCOUNT_ID_DEMO', 'OANDA_ACCOUNT_CCY_DEMO',
      'MAX_OPEN_POSITIONS', 'MAX_TOTAL_DRAWDOWN_PCT', 'NEWS_BLACKOUT_ENABLED', 'AUTO_TRADE_ENABLED',
    ]) delete process.env[k];
    const c = level2Config();
    expect(c.tradingMode).toBe('demo');
    expect(c.demo.accountId).toBeUndefined();
    expect(c.demo.accountCcy).toBe('GBP');
    expect(c.maxOpenPositions).toBe(2);
    expect(c.maxTotalDrawdownPct).toBe(20);
    expect(c.newsBlackoutEnabled).toBe(true);
    expect(c.autoTradeEnabled).toBe(true);
  });

  it('parses env values', () => {
    process.env.TRADING_MODE = 'demo';
    process.env.OANDA_ACCOUNT_ID_DEMO = '101-004-TEST-001';
    process.env.OANDA_ACCOUNT_CCY_DEMO = 'USD';
    process.env.MAX_OPEN_POSITIONS = '3';
    process.env.NEWS_BLACKOUT_ENABLED = 'false';
    const c = level2Config();
    expect(c.demo.accountId).toBe('101-004-TEST-001');
    expect(c.demo.accountCcy).toBe('USD');
    expect(c.maxOpenPositions).toBe(3);
    expect(c.newsBlackoutEnabled).toBe(false);
  });

  it('treats blank account id as unset (seed will skip)', () => {
    process.env.OANDA_ACCOUNT_ID_DEMO = '   ';
    expect(level2Config().demo.accountId).toBeUndefined();
  });
});
