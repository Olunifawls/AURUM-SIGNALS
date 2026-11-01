import * as fs from 'fs';
import * as path from 'path';
import { SMOKE_QUERIES } from './db-smoke.queries';
import { formatResult, runQuery, runSmoke, smokeUrl } from './db-smoke';

const ENV = { SUPABASE_URL: 'https://db.test/', SUPABASE_SERVICE_ROLE_KEY: 'secret-key' };

function respondWith(statusOf: (url: string) => number, body = '[]') {
  return jest.fn(async (url: string) => new Response(body, { status: statusOf(url) })) as unknown as jest.MockedFunction<typeof fetch>;
}

describe('db smoke', () => {
  it('sends every query as a GET with limit=1 and no body', async () => {
    const get = respondWith(() => 200);
    const code = await runSmoke(ENV, () => undefined, get);

    expect(code).toBe(0);
    expect(get).toHaveBeenCalledTimes(SMOKE_QUERIES.length);
    for (const [url, init] of get.mock.calls) {
      expect(init?.method).toBe('GET');
      expect(init?.body).toBeUndefined();
      expect(new URL(String(url)).searchParams.get('limit')).toBe('1');
    }
  });

  it('exits non-zero and prints the status when any query is not 2xx', async () => {
    const lines: string[] = [];
    const ledger = new URL(smokeUrl(ENV.SUPABASE_URL, SMOKE_QUERIES[0])).search;
    const get = respondWith((url) => (url.endsWith(ledger) ? 300 : 200), '{"code":"PGRST201"}');

    expect(await runSmoke(ENV, (l) => lines.push(l), get)).toBe(1);
    const output = lines.join('\n');
    expect(output).toContain('300 forward-test ledger: evaluations');
    expect(output).toContain('PGRST201');
    expect(output).toContain(`FAILED: 1 of ${SMOKE_QUERIES.length}`);
  });

  it('counts a network failure as a failure', async () => {
    const get = jest.fn(async () => {
      throw new Error('connection refused');
    }) as unknown as typeof fetch;

    const result = await runQuery('https://db.test', 'k', SMOKE_QUERIES[0], get);
    expect(result.status).toBeNull();
    expect(formatResult(result)).toContain('ERR');
    expect(await runSmoke(ENV, () => undefined, get)).toBe(1);
  });

  it('exits non-zero without credentials and sends nothing', async () => {
    const get = respondWith(() => 200);
    expect(await runSmoke({}, () => undefined, get)).toBe(2);
    expect(get).not.toHaveBeenCalled();
  });

  it('never prints the key or row data', async () => {
    const lines: string[] = [];
    await runSmoke(ENV, (l) => lines.push(l), respondWith(() => 200, '[{"entry_price":4000}]'));
    const output = lines.join('\n');
    expect(output).not.toContain('secret-key');
    expect(output).not.toContain('entry_price');
  });

  it('removes spaces from selects, as supabase-js does', () => {
    const query = { name: 'q', source: 's', table: 'positions', select: 'side, signals(timeframe)' };
    expect(new URL(smokeUrl('https://db.test', query)).searchParams.get('select')).toBe('side,signals(timeframe)');
  });

  it('has no imports that could write, send Telegram or call OANDA', () => {
    const source = fs.readFileSync(path.join(__dirname, 'db-smoke.ts'), 'utf8');
    const imports = [...source.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
    expect(imports.sort()).toEqual(['../load-env', './db-smoke.queries']);
    expect(source).not.toMatch(/method:\s*'(POST|PUT|PATCH|DELETE)'/);
  });
});
