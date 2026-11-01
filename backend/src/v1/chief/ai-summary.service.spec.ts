import { AiSummaryService } from './ai-summary.service';
import { analystClient, MAX_PACK_CHARS, packPrompt, unsupportedNumbers } from './ai-summary';
import { EvidencePack } from './chief-analyst';

const pack = {
  ruleset: 'v1',
  eligible: true,
  caseFor: ['regime: Gold close 4012.50 is above its 50-day mean 3950.10.'],
  caseAgainst: [],
  invalidationLevel: 3990,
  target: 4050,
} as unknown as EvidencePack;

const events = () => ({ warn: jest.fn(async () => undefined) });

class Fake extends AiSummaryService {
  create = jest.fn();
  sink: ReturnType<typeof events>;
  constructor(sink = events()) {
    super(sink as any);
    this.sink = sink;
  }
  protected override client(): any {
    return { messages: { create: this.create } };
  }
}

const reply = (text: string, stop_reason = 'end_turn') => ({ stop_reason, content: [{ type: 'text', text }], usage: { input_tokens: 500, output_tokens: 100 } });

describe('unsupportedNumbers', () => {
  it('accepts numbers from the pack and flags invented ones', () => {
    expect(unsupportedNumbers('Close 4012.50, stop 3,990, target 4050.', pack)).toEqual([]);
    expect(unsupportedNumbers('Gold could reach 4200 by Friday.', pack)).toEqual(['4200']);
  });
});

function expectOneWarn(svc: Fake, reason: string) {
  expect(svc.sink.warn).toHaveBeenCalledTimes(1);
  expect(svc.sink.warn).toHaveBeenCalledWith('v1', `AI summary failed: ${reason}`, { reason });
}

describe('AiSummaryService', () => {
  const OLD = { ...process.env };
  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    delete process.env.ANALYST_MODEL;
  });
  afterEach(() => (process.env = { ...OLD }));

  it('makes no call without ANTHROPIC_API_KEY, and warns once', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const svc = new Fake();
    await expect(svc.summarise(pack)).resolves.toBeNull();
    expect(svc.create).not.toHaveBeenCalled();
    expectOneWarn(svc, 'ANTHROPIC_API_KEY not set');
  });

  it('defaults to claude-haiku-5-5 and sends the pack', async () => {
    const svc = new Fake();
    svc.create.mockResolvedValue(reply('Eligible BUY, stop 3990, target 4050.'));
    await expect(svc.summarise(pack)).resolves.toEqual({ text: 'Eligible BUY, stop 3990, target 4050.', model: 'claude-haiku-5-5' });
    const req = svc.create.mock.calls[0][0];
    expect(req.model).toBe('claude-haiku-5-5');
    expect(req.output_config).toEqual({ effort: 'low' });
    expect(req.max_tokens).toBe(400);
    expect(req.thinking).toEqual({ type: 'disabled' }); // thinking would use up the cap
    expect(req.messages[0].content).toBe(JSON.stringify(pack));
    expect(req.system).toContain('120 words');
    expect(req.system).toContain('only facts stated in the pack');
  });

  it('uses ANALYST_MODEL when set', async () => {
    process.env.ANALYST_MODEL = 'claude-sonnet-5-5';
    const svc = new Fake();
    svc.create.mockResolvedValue(reply('Eligible.'));
    expect((await svc.summarise(pack))?.model).toBe('claude-sonnet-5-5');
    expect(svc.create.mock.calls[0][0].thinking).toBeUndefined(); // this model would reject it
  });

  it('warns nothing on success', async () => {
    const svc = new Fake();
    svc.create.mockResolvedValue(reply('Eligible.'));
    await svc.summarise(pack);
    expect(svc.sink.warn).not.toHaveBeenCalled();
  });

  it('gives up after exactly 20s even if the call never returns', async () => {
    jest.useFakeTimers();
    try {
      const svc = new Fake();
      svc.create.mockReturnValue(new Promise(() => undefined));
      const done = jest.fn();
      const run = svc.summarise(pack).then(done);
      await jest.advanceTimersByTimeAsync(19_999);
      expect(done).not.toHaveBeenCalled();
      await jest.advanceTimersByTimeAsync(1);
      await run;
      expect(done).toHaveBeenCalledWith(null);
      expectOneWarn(svc, 'timeout');
      expect(svc.create.mock.calls[0][1].signal.aborted).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  it.each([
    [400, 'HTTP 400'],
    [401, 'HTTP 401'],
    [429, 'HTTP 429'],
    [500, 'HTTP 500'],
    [529, 'HTTP 529'],
  ])('handles HTTP %i through the real client', async (status, reason) => {
    class RealClient extends Fake {
      protected override client(): any {
        const respond = async () => new Response('{"type":"error","error":{"message":"secret-echo"}}', { status, headers: { 'content-type': 'application/json' } });
        return analystClient('test-key', respond as unknown as typeof fetch);
      }
    }
    const svc = new RealClient();
    await expect(svc.summarise(pack)).resolves.toBeNull();
    expectOneWarn(svc, reason);
    expect(JSON.stringify(svc.sink.warn.mock.calls)).not.toContain('secret-echo');
  });

  it('never puts the key or a raw error in the WARN', async () => {
    const svc = new Fake();
    svc.create.mockRejectedValue(new Error('request failed for test-key'));
    await expect(svc.summarise(pack)).resolves.toBeNull();
    expectOneWarn(svc, 'unexpected error');
    expect(JSON.stringify(svc.sink.warn.mock.calls)).not.toContain('test-key');
  });

  it('still returns null if the WARN itself fails', async () => {
    const svc = new Fake({ warn: jest.fn(async () => { throw new Error('db down'); }) } as any);
    svc.create.mockRejectedValue(new Error('x'));
    await expect(svc.summarise(pack)).resolves.toBeNull();
  });

  it.each(['refusal', 'max_tokens'])('discards a %s response', async (stop) => {
    const svc = new Fake();
    svc.create.mockResolvedValue(reply('Partial.', stop));
    await expect(svc.summarise(pack)).resolves.toBeNull();
    expectOneWarn(svc, `stop_reason ${stop}`);
  });

  it('discards a summary with a number the pack does not contain', async () => {
    const svc = new Fake();
    svc.create.mockResolvedValue(reply('Target is really 4200.'));
    await expect(svc.summarise(pack)).resolves.toBeNull();
    expectOneWarn(svc, 'numbers not in the pack: 4200');
  });

  it('discards an empty reply', async () => {
    const svc = new Fake();
    svc.create.mockResolvedValue({ stop_reason: 'end_turn', content: [] });
    await expect(svc.summarise(pack)).resolves.toBeNull();
    expectOneWarn(svc, 'empty reply');
  });

  it('reads the text past any thinking block', async () => {
    const svc = new Fake();
    svc.create.mockResolvedValue({ stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: 'Eligible.' }], usage: { input_tokens: 1, output_tokens: 1 } });
    expect((await svc.summarise(pack))?.text).toBe('Eligible.');
  });

  it('caps an oversized pack without changing the stored one', async () => {
    const huge = { ...pack, caseFor: Array.from({ length: 5000 }, (_, i) => `reason ${i} `.repeat(20)) };
    const before = JSON.stringify(huge);
    const svc = new Fake();
    svc.create.mockResolvedValue(reply('Eligible.'));
    await svc.summarise(huge);
    const sent = svc.create.mock.calls[0][0].messages[0].content as string;
    expect(sent.length).toBeLessThanOrEqual(MAX_PACK_CHARS + 20);
    expect(sent).toContain('[pack truncated]');
    expect(JSON.stringify(huge)).toBe(before);
    expect(packPrompt(pack)).toBe(JSON.stringify(pack));
  });

  it('builds a client with a 20s timeout and no retries', () => {
    const client = analystClient('k');
    expect(client.timeout).toBe(20_000);
    expect(client.maxRetries).toBe(0);
  });
});
