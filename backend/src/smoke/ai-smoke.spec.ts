import * as fs from 'fs';
import * as path from 'path';
import { runAiSmoke, SAMPLE_PACK } from './ai-smoke';
import { unsupportedNumbers } from '../v1/chief/ai-summary';

const ENV = { ANTHROPIC_API_KEY: 'sk-test-secret' };
const SUMMARY = 'Eligible 4h BUY at 4012.5 with invalidation 3990 and target 4057.5; 2Y yields are the case against.';

/** Stands in for the network under the real SDK client. */
function http(status: number, body: unknown) {
  return jest.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })) as unknown as jest.MockedFunction<typeof fetch>;
}

const message = (text: string, stop_reason = 'end_turn') => ({
  id: 'msg_1',
  type: 'message',
  role: 'assistant',
  model: 'claude-haiku-5-5',
  content: [{ type: 'text', text }],
  stop_reason,
  usage: { input_tokens: 512, output_tokens: 148 },
});

async function run(get: typeof fetch, env: Record<string, string> = ENV, timeoutMs?: number) {
  const lines: string[] = [];
  const code = await runAiSmoke(env, (l) => lines.push(l), { fetch: get, timeoutMs });
  return { code, output: lines.join('\n') };
}

describe('ai smoke', () => {
  it('exits 0 and prints the model, latency, tokens and summary from one request', async () => {
    const get = http(200, message(SUMMARY));
    const { code, output } = await run(get);

    expect(code).toBe(0);
    expect(get).toHaveBeenCalledTimes(1);
    expect(String(get.mock.calls[0][0])).toContain('/v1/messages');
    expect(output).toContain('model:         claude-haiku-5-5');
    expect(output).toMatch(/latency: +\d+ ms/);
    expect(output).toContain('input tokens:  512');
    expect(output).toContain('output tokens: 148');
    expect(output).toContain(SUMMARY);
  });

  it('prints at most 300 characters of the summary', async () => {
    const long = 'word '.repeat(200).trim();
    const { code, output } = await run(http(200, message(long)));
    expect(code).toBe(0);
    expect(output).toContain(long.slice(0, 300));
    expect(output).not.toContain(long.slice(0, 301));
  });

  it('honours ANALYST_MODEL', async () => {
    const get = http(200, message(SUMMARY));
    await run(get, { ...ENV, ANALYST_MODEL: 'claude-sonnet-5-5' });
    expect(JSON.parse(String(get.mock.calls[0][1]?.body)).model).toBe('claude-sonnet-5-5');
  });

  it.each([
    [401, 'HTTP 401'],
    [429, 'HTTP 429'],
    [500, 'HTTP 500'],
  ])('exits 1 on HTTP %i', async (status, reason) => {
    const { code, output } = await run(http(status, { type: 'error', error: { type: 'api_error', message: 'nope' } }));
    expect(code).toBe(1);
    expect(output).toContain(`FAILED: ${reason}`);
  });

  it('exits 1 on a bad response', async () => {
    const { code, output } = await run(http(200, message('Partial', 'max_tokens')));
    expect(code).toBe(1);
    expect(output).toContain('FAILED: stop_reason max_tokens');
  });

  it('exits 1 on a timeout', async () => {
    const hang = jest.fn(() => new Promise<Response>(() => undefined)) as unknown as typeof fetch;
    const { code, output } = await run(hang, ENV, 10);
    expect(code).toBe(1);
    expect(output).toContain('FAILED: timeout');
  });

  it('exits 2 with no key and sends nothing', async () => {
    const get = http(200, message(SUMMARY));
    expect((await run(get, {})).code).toBe(2);
    expect((await run(get, { ANTHROPIC_API_KEY: '  ' })).code).toBe(2);
    expect(get).not.toHaveBeenCalled();
  });

  it('never prints the key, even on an auth failure', async () => {
    const { output } = await run(http(401, { type: 'error', error: { type: 'authentication_error', message: 'bad key sk-test-secret' } }));
    expect(output).not.toContain('sk-test-secret');
  });

  it('has a sample pack whose summary would pass the number check', () => {
    expect(unsupportedNumbers(SUMMARY, SAMPLE_PACK)).toEqual([]);
  });

  it('has no imports that could write, send Telegram or call OANDA', () => {
    const importsOf = (file: string) => [...fs.readFileSync(path.join(__dirname, file), 'utf8').matchAll(/from '([^']+)'/g)].map((m) => m[1]);
    expect(importsOf('ai-smoke.ts').sort()).toEqual(['../load-env', '../v1/chief/ai-summary', '../v1/chief/chief-analyst']);
    expect(importsOf('../v1/chief/ai-summary.ts').sort()).toEqual(['./chief-analyst', '@anthropic-ai/sdk']);
  });

  it.each(['ai-smoke.ts', '../v1/chief/ai-summary.ts'])('%s uses chief-analyst for its type only', (file) => {
    const source = fs.readFileSync(path.join(__dirname, file), 'utf8');
    expect(source).toMatch(/import \{ EvidencePack \} from '.*chief-analyst'/);
  });
});
