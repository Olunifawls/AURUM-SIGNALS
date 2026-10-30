import { AiSummaryService, unsupportedNumbers } from './ai-summary.service';
import { EvidencePack } from './chief-analyst';

const pack = {
  ruleset: 'v1',
  eligible: true,
  caseFor: ['regime: Gold close 4012.50 is above its 50-day mean 3950.10.'],
  caseAgainst: [],
  invalidationLevel: 3990,
  target: 4050,
} as unknown as EvidencePack;

class Fake extends AiSummaryService {
  create = jest.fn();
  protected override client(): any {
    return { messages: { create: this.create } };
  }
}

const reply = (text: string, stop_reason = 'end_turn') => ({ stop_reason, content: [{ type: 'text', text }] });

describe('unsupportedNumbers', () => {
  it('accepts numbers from the pack and flags invented ones', () => {
    expect(unsupportedNumbers('Close 4012.50, stop 3,990, target 4050.', pack)).toEqual([]);
    expect(unsupportedNumbers('Gold could reach 4200 by Friday.', pack)).toEqual(['4200']);
  });
});

describe('AiSummaryService', () => {
  const OLD = { ...process.env };
  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    delete process.env.ANALYST_MODEL;
  });
  afterEach(() => (process.env = { ...OLD }));

  it('makes no call without ANTHROPIC_API_KEY', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const svc = new Fake();
    await expect(svc.summarise(pack)).resolves.toBeNull();
    expect(svc.create).not.toHaveBeenCalled();
  });

  it('defaults to claude-haiku-5-5 and sends the pack', async () => {
    const svc = new Fake();
    svc.create.mockResolvedValue(reply('Eligible BUY, stop 3990, target 4050.'));
    await expect(svc.summarise(pack)).resolves.toEqual({ text: 'Eligible BUY, stop 3990, target 4050.', model: 'claude-haiku-5-5' });
    const req = svc.create.mock.calls[0][0];
    expect(req.model).toBe('claude-haiku-5-5');
    expect(req.messages[0].content).toBe(JSON.stringify(pack));
    expect(req.system).toContain('120 words');
    expect(req.system).toContain('only facts stated in the pack');
  });

  it('uses ANALYST_MODEL when set', async () => {
    process.env.ANALYST_MODEL = 'claude-sonnet-5-5';
    const svc = new Fake();
    svc.create.mockResolvedValue(reply('Eligible.'));
    expect((await svc.summarise(pack))?.model).toBe('claude-sonnet-5-5');
  });

  it('returns null on an API error or timeout', async () => {
    const svc = new Fake();
    svc.create.mockRejectedValue(new Error('timeout'));
    await expect(svc.summarise(pack)).resolves.toBeNull();
  });

  it.each(['refusal', 'max_tokens'])('discards a %s response', async (stop) => {
    const svc = new Fake();
    svc.create.mockResolvedValue(reply('Partial.', stop));
    await expect(svc.summarise(pack)).resolves.toBeNull();
  });

  it('discards a summary with a number the pack does not contain', async () => {
    const svc = new Fake();
    svc.create.mockResolvedValue(reply('Target is really 4200.'));
    await expect(svc.summarise(pack)).resolves.toBeNull();
  });

  it('discards an empty reply', async () => {
    const svc = new Fake();
    svc.create.mockResolvedValue({ stop_reason: 'end_turn', content: [] });
    await expect(svc.summarise(pack)).resolves.toBeNull();
  });

  it('builds a client with a 20s timeout and no retries', () => {
    const client = (new AiSummaryService() as any).client('k');
    expect(client.timeout).toBe(20_000);
    expect(client.maxRetries).toBe(0);
  });
});
