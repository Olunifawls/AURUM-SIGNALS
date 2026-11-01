import { loadRepoEnv } from '../load-env';
import { SMOKE_QUERIES, SmokeQuery } from './db-smoke.queries';

/**
 * Read-only check that every query below is accepted by the hosted Supabase.
 * It uses plain GETs with limit=1 and no Supabase client, so it has no way to
 * write, and it imports nothing that talks to Telegram or OANDA.
 */

const TIMEOUT_MS = 15_000;
const MAX_ERROR_CHARS = 700;

export interface SmokeResult {
  query: SmokeQuery;
  status: number | null; // null: no HTTP response
  error: string | null;
}

/** supabase-js strips spaces from select strings, so the check does too. */
export function smokeUrl(baseUrl: string, query: SmokeQuery): string {
  const params = new URLSearchParams({ select: query.select.replace(/\s/g, ''), ...query.filters, limit: '1' });
  return `${baseUrl.replace(/\/+$/, '')}/rest/v1/${query.table}?${params.toString()}`;
}

export const passed = (result: SmokeResult): boolean => result.status != null && result.status >= 200 && result.status < 300;

export async function runQuery(baseUrl: string, key: string, query: SmokeQuery, get: typeof fetch = fetch): Promise<SmokeResult> {
  try {
    const res = await get(smokeUrl(baseUrl, query), {
      method: 'GET',
      headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' },
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = await res.text(); // row data stays here; only error bodies are printed
    const ok = res.status >= 200 && res.status < 300;
    return { query, status: res.status, error: ok ? null : body.slice(0, MAX_ERROR_CHARS) };
  } catch (err) {
    return { query, status: null, error: err instanceof Error ? err.message : String(err) };
  }
}

export function formatResult({ query, status, error }: SmokeResult): string {
  const line = `${String(status ?? 'ERR').padEnd(4)}${query.name} [${query.table}]`;
  return error ? `${line}\n      ${error}` : line;
}

/** Returns the process exit code. */
export async function runSmoke(
  env: Record<string, string | undefined>,
  log: (line: string) => void = console.log,
  get: typeof fetch = fetch,
): Promise<number> {
  const { SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: key } = env;
  if (!url || !key) {
    log('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
    return 2;
  }
  log(`DB smoke: ${SMOKE_QUERIES.length} GET queries, limit=1, read-only`);
  let failed = 0;
  for (const query of SMOKE_QUERIES) {
    const result = await runQuery(url, key, query, get);
    if (!passed(result)) failed++;
    log(formatResult(result));
  }
  log(failed ? `FAILED: ${failed} of ${SMOKE_QUERIES.length} queries` : `OK: all ${SMOKE_QUERIES.length} queries returned 2xx`);
  return failed ? 1 : 0;
}

if (require.main === module) {
  loadRepoEnv();
  runSmoke(process.env).then(
    (code) => {
      process.exitCode = code;
    },
    (err) => {
      console.error(err);
      process.exitCode = 1;
    },
  );
}
