import { scrubSecrets, scrubString } from './scrub';

describe('(e) SECRET SCRUB', () => {
  const OLD = { ...process.env };
  beforeEach(() => {
    process.env.OANDA_API_TOKEN_DEMO = 'abcd1234deadbeefabcd1234deadbeef-oanda';
    process.env.TELEGRAM_BOT_TOKEN = '123456789:AA_telegramSecretToken';
  });
  afterEach(() => (process.env = { ...OLD }));

  it('redacts the OANDA token value wherever it appears', () => {
    const out = scrubString('request used token abcd1234deadbeefabcd1234deadbeef-oanda in header');
    expect(out).not.toContain('abcd1234deadbeefabcd1234deadbeef-oanda');
    expect(out).toContain('***REDACTED***');
  });

  it('redacts Bearer tokens and Telegram bot-token URLs', () => {
    expect(scrubString('Authorization: Bearer abc.def-ghi_123+xyz=')).not.toContain('abc.def-ghi_123');
    expect(scrubString('https://api.telegram.org/bot123456789:AA_telegramSecretToken/getUpdates')).not.toContain('AA_telegramSecretToken');
  });

  it('scrubs secrets inside an object (e.g. a stored raw_response)', () => {
    const raw = { note: 'token abcd1234deadbeefabcd1234deadbeef-oanda', ok: true };
    const scrubbed = scrubSecrets(raw);
    expect(JSON.stringify(scrubbed)).not.toContain('abcd1234deadbeefabcd1234deadbeef-oanda');
    expect(scrubbed.ok).toBe(true);
  });

  it('leaves token-free text unchanged', () => {
    expect(scrubString('MARKET_HALTED: no secrets here')).toBe('MARKET_HALTED: no secrets here');
  });
});
