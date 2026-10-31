#!/usr/bin/env node
// End-to-end security tests for the middleware and the API proxies. Builds the real
// frontend with dummy values, starts it against a local stub for the backend and
// Supabase Auth, and sends every case with curl --path-as-is, so raw encoded paths
// reach the server untouched. Nothing here reaches the VPS or the hosted database.
//
//   npm test --workspace=frontend          build, run, exit 1 on any failure
//   SKIP_BUILD=1                           reuse the current .next
//   REPORT=/path/out.json                  also write every result as JSON
//
// Needs curl and free ports 39117 and 39118. The dummy values are baked into
// frontend/.next, so run `npm run build` afterwards before using that build.
import { execFile, spawn, spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const curl = promisify(execFile);
const FRONTEND = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const STUB_PORT = 39117;
const APP_PORT = 39118;
const STUB = `http://127.0.0.1:${STUB_PORT}`;
const APP = `http://127.0.0.1:${APP_PORT}`;
const ADMIN_TOKEN = 'dummy-admin-token-e2e';
const GOOD_TOKEN = 'dummy-good-access-token';
const BAD_TOKEN = 'dummy-expired-access-token';
const EXTENSIONS = ['.png', '.svg', '.jpg', '.jpeg', '.gif', '.webp', '.ico'];

const env = {
  ...process.env,
  NEXT_TELEMETRY_DISABLED: '1',
  NEXT_PUBLIC_SUPABASE_URL: STUB,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'dummy-publishable-key',
  ADMIN_API_TOKEN: ADMIN_TOKEN,
  BACKEND_URL: STUB,
};

// One server plays Supabase Auth and the backend. Their paths never overlap, and
// only backend calls are recorded: a case passes on how many of those it caused.
let upstream = [];
let logouts = 0;
let refreshes = 0;
const stub = createServer((req, res) => {
  req.resume();
  req.on('end', () => {
    res.setHeader('content-type', 'application/json');
    if (req.url === '/auth/v1/user') {
      if (req.headers.authorization !== `Bearer ${GOOD_TOKEN}`) {
        res.statusCode = 401;
        return res.end('{"message":"invalid token"}');
      }
      return res.end(JSON.stringify({ id: 'u1', aud: 'authenticated', role: 'authenticated', email: 'o@e2e.test' }));
    }
    if (req.url.startsWith('/auth/v1/token')) {
      refreshes += 1;
      const session = sessionJson(GOOD_TOKEN, 3600);
      return res.end(JSON.stringify(session));
    }
    if (req.url.startsWith('/auth/v1/logout')) {
      logouts += 1;
      res.statusCode = 204;
      return res.end();
    }
    upstream.push({ method: req.method, url: req.url, token: req.headers['x-admin-token'] ?? null });
    res.end('{"ok":true}');
  });
});

function sessionJson(accessToken, expiresIn) {
  return {
    access_token: accessToken,
    refresh_token: 'dummy-refresh',
    token_type: 'bearer',
    expires_in: expiresIn,
    expires_at: Math.floor(Date.now() / 1000) + expiresIn,
    user: { id: 'u1', aud: 'authenticated', role: 'authenticated', email: 'o@e2e.test' },
  };
}
function sessionCookie(accessToken, expiresIn = 3600) {
  const value = Buffer.from(JSON.stringify(sessionJson(accessToken, expiresIn))).toString('base64url');
  return `sb-127-auth-token=base64-${value}`;
}
const LOGGED_IN = sessionCookie(GOOD_TOKEN);
const BAD_SESSION = sessionCookie(BAD_TOKEN);
const NEEDS_REFRESH = sessionCookie(BAD_TOKEN, -60);

const cases = [];
const add = (group, method, path, expect, opts = {}) => cases.push({ group, method, path, expect, ...opts });

const refused = { status: [401, 307], location: ['/login', null], upstream: 0 };
const notForwarded = { upstream: 0, notStatus: [200] };
const closeBody = '{"tradeId":"123"}';
const resetBody = '{"confirm":"WIPE_LEDGER_DEMO"}';

for (const ext of EXTENSIONS) {
  const g = `logged out, ${ext}`;
  add(g, 'GET', `/api/exec/state%3Fx=${ext}`, refused);
  add(g, 'POST', `/api/exec/halt%3Fx=${ext}`, refused, { body: '{}' });
  add(g, 'POST', `/api/exec/close%3Fx=${ext}`, refused, { body: closeBody });
  add(g, 'POST', `/api/exec/..%2Fadmin%2Freset%3Fx=${ext}`, refused, { body: resetBody });
  add(g, 'GET', `/api/proxy/api%2Fhealth%3Fx=${ext}`, refused);
  add(g, 'GET', `/api/proxy/api/signals%3Fx=${ext}`, refused);
  add(g, 'POST', `/api/proxy/api%2Fhealth%3Fx=${ext}`, refused, { body: '{}' });
  add(g, 'GET', `/api/proxy/api/execution/state%3Fx=${ext}`, refused);
  add(g, 'GET', `/api/proxy/..%2Fapi%2Fexecution%2Fstate%3Fx=${ext}`, refused);
}

const g1 = 'logged out, plain routes';
add(g1, 'GET', '/api/exec/state', refused);
add(g1, 'POST', '/api/exec/halt', refused, { body: '{}' });
add(g1, 'POST', '/api/exec/close', refused, { body: closeBody });
add(g1, 'GET', '/api/proxy/api/health', refused);
add(g1, 'POST', '/api/settings/risk-pct', refused, { body: '{"risk_pct":5}' });
add(g1, 'POST', '/api/settings/account', refused, { body: '{"account_size":1}' });
add(g1, 'GET', '/api/exec/state', refused, { cookie: BAD_SESSION, label: 'expired session' });

const g2 = 'logged out, other evasions';
add(g2, 'GET', '/api/exec/%73tate%3Fx=.png', notForwarded);
add(g2, 'GET', '/api/exec/..%252Fadmin%252Freset%3Fx=.png', notForwarded);
add(g2, 'GET', '/api/exec/state.png', notForwarded);
add(g2, 'GET', '/api/%65xec/state', notForwarded);
add(g2, 'GET', '/API/exec/state.png', notForwarded);
add(g2, 'GET', '//api/exec/state%3Fx=.png', notForwarded);
add(g2, 'GET', '/_next/static/..%2F..%2Fapi%2Fexec%2Fstate', notForwarded);
add(g2, 'GET', '/_next/static/../../api/exec/state', notForwarded);
add(g2, 'GET', '/favicon.ico/..%2Fapi%2Fexec%2Fstate', notForwarded);
add(g2, 'GET', '/login/..%2Fapi%2Fexec%2Fstate', notForwarded);
add(g2, 'GET', '/login/../api/exec/state', notForwarded);
add(g2, 'GET', '/api/auth/..%2Fexec%2Fstate', notForwarded);
add(g2, 'GET', '/api/auth/../exec/state', notForwarded);
add(g2, 'GET', '/_next/image?url=%2Fapi%2Fexec%2Fstate&w=64&q=75', notForwarded);

const g3 = 'logged in, allowlisted';
const forwarded = (url, token) => ({ status: [200], upstream: 1, url, token });
for (const p of ['state', 'positions', 'orders', 'equity', 'risk-events', 'forward-test']) {
  add(g3, 'GET', `/api/exec/${p}`, forwarded(`/api/execution/${p}`, ADMIN_TOKEN), { cookie: LOGGED_IN });
}
add(g3, 'POST', '/api/exec/halt', forwarded('/api/execution/halt', ADMIN_TOKEN), { cookie: LOGGED_IN, body: '{}' });
add(g3, 'POST', '/api/exec/close', forwarded('/api/execution/close', ADMIN_TOKEN), { cookie: LOGGED_IN, body: closeBody });
add(g3, 'POST', '/api/settings/risk-pct', forwarded('/api/settings/risk-pct', ADMIN_TOKEN), { cookie: LOGGED_IN, body: '{"risk_pct":1}' });
add(g3, 'POST', '/api/settings/account', forwarded('/api/settings/account', ADMIN_TOKEN), { cookie: LOGGED_IN, body: '{"account_size":1}' });
for (const p of ['api/market/snapshot', 'api/health', 'api/signals/active', 'api/sizing/tier-status', 'api/settings', 'api/performance']) {
  add(g3, 'GET', `/api/proxy/${p}`, forwarded(`/${p}`, null), { cookie: LOGGED_IN });
}
add(g3, 'GET', '/api/proxy/api/signals?limit=200', forwarded('/api/signals?limit=200', null), { cookie: LOGGED_IN });
// The session check in the handlers must not spend a single-use refresh token twice.
add(g3, 'GET', '/api/exec/state', { ...forwarded('/api/execution/state', ADMIN_TOKEN), refreshes: 1 }, { cookie: NEEDS_REFRESH, label: 'token refreshed once' });

const g4 = 'logged in, traversal gets 400';
const rejected = { status: [400], upstream: 0 };
for (const [method, path, body] of [
  ['GET', '/api/exec/state%3Fx=.png'],
  ['POST', '/api/exec/halt%3Fx=.png', '{}'],
  ['POST', '/api/exec/close%3Fx=.png', closeBody],
  ['POST', '/api/exec/..%2Fadmin%2Freset%3Fx=.png', resetBody],
  ['GET', '/api/exec/..%2Fadmin%2Freset'],
  ['GET', '/api/exec/state%2Fx'],
  ['GET', '/api/exec/state%5Cx'],
  ['GET', '/api/exec/state%3Fx'],
  ['GET', '/api/exec/state%23x'],
  ['GET', '/api/exec/%2e%2e%2fadmin%2freset'],
  ['GET', '/api/exec/..%5Cadmin'],
  ['GET', '/api/exec/%252Fstate'],
  ['GET', '/api/exec/%73tate'],
  ['GET', '/api/proxy/api%2Fhealth'],
  ['GET', '/api/proxy/api/health%3Fx=.png'],
  ['GET', '/api/proxy/..%2Fapi%2Fexecution%2Fstate'],
  ['GET', '/api/proxy/api/execution/..%2Fexecution%2Fstate'],
  ['GET', '/api/proxy/api/health%23x'],
  ['GET', '/api/proxy/api/health%5Cx'],
]) {
  add(g4, method, path, rejected, { cookie: LOGGED_IN, body });
}

const g5 = 'logged in, outside the allowlist';
const missing = { status: [404], upstream: 0 };
const wrongMethod = { status: [405], upstream: 0 };
// Next resolves these dot segments before middleware or a handler runs, so they can
// only arrive as the path they resolve to: no route here, or a normal exec route.
add(g5, 'GET', '/api/exec/%2E%2E/admin/reset', missing, { cookie: LOGGED_IN, label: 'resolved by Next' });
add(g5, 'GET', '/api/exec/../admin/reset', missing, { cookie: LOGGED_IN, label: 'resolved by Next' });
add(g5, 'POST', '/api/exec/../admin/reset', missing, { cookie: LOGGED_IN, body: resetBody, label: 'resolved by Next' });
add(g5, 'GET', '/api/exec/state/../halt', wrongMethod, { cookie: LOGGED_IN, label: 'resolved by Next' });
add(g5, 'GET', '/api/exec/nope', missing, { cookie: LOGGED_IN });
add(g5, 'GET', '/api/exec/state/x', missing, { cookie: LOGGED_IN });
add(g5, 'GET', '/api/exec/halt', wrongMethod, { cookie: LOGGED_IN });
add(g5, 'POST', '/api/exec/state', wrongMethod, { cookie: LOGGED_IN, body: '{}' });
add(g5, 'GET', '/api/proxy/api/execution/state', missing, { cookie: LOGGED_IN });
add(g5, 'GET', '/api/proxy/health', missing, { cookie: LOGGED_IN });
add(g5, 'GET', '/api/proxy/api/admin/reset', missing, { cookie: LOGGED_IN });
add(g5, 'POST', '/api/proxy/api/health', wrongMethod, { cookie: LOGGED_IN, body: '{}' });
add(g5, 'GET', '/api/exec/state?x=1', forwarded('/api/execution/state', ADMIN_TOKEN), { cookie: LOGGED_IN, label: 'query dropped' });
add(g5, 'GET', '/api/proxy/api/signals?limit=abc&status=x', forwarded('/api/signals', null), { cookie: LOGGED_IN, label: 'query dropped' });

const g6 = 'pages and sign-in unchanged';
add(g6, 'GET', '/login', { status: [200], upstream: 0 });
add(g6, 'GET', '/', { status: [307], location: ['/login'], upstream: 0 });
add(g6, 'GET', '/execution', { status: [307], location: ['/login'], upstream: 0 });
add(g6, 'GET', '/', { status: [200] }, { cookie: LOGGED_IN });
add(g6, 'GET', '/execution', { status: [200] }, { cookie: LOGGED_IN });
add(g6, 'GET', '/login', { status: [307], location: ['/'], upstream: 0 }, { cookie: LOGGED_IN });
add(g6, 'POST', '/api/auth/signout', { status: [302], location: ['/login'], upstream: 0 });
add(g6, 'POST', '/api/auth/signout', { status: [302], location: ['/login'], upstream: 0, logouts: 1 }, { cookie: LOGGED_IN });
add(g6, 'GET', '/favicon.ico', { status: [404], upstream: 0 });

async function send(c) {
  const args = ['-s', '--path-as-is', '-o', '/dev/null', '-w', '%{http_code} %{redirect_url}', '-m', '20', '-X', c.method];
  if (c.cookie) args.push('-H', `cookie: ${c.cookie}`);
  if (c.body !== undefined) args.push('-H', 'content-type: application/json', '-d', c.body);
  args.push(`${APP}${c.path}`);
  const { stdout } = await curl('curl', args).catch((e) => ({ stdout: e.stdout || '000 ' }));
  const [status, redirect = ''] = stdout.trim().split(' ');
  return { status: Number(status), location: redirect ? new URL(redirect).pathname : null };
}

function problems(c, got, calls, logoutCalls, refreshCalls) {
  const e = c.expect;
  const out = [];
  if (e.status && !e.status.includes(got.status)) out.push(`status ${got.status}, wanted ${e.status.join('/')}`);
  if (e.notStatus?.includes(got.status)) out.push(`status ${got.status}`);
  if (e.location && !e.location.includes(got.location)) out.push(`location ${got.location}`);
  if (e.upstream !== undefined && calls.length !== e.upstream) out.push(`upstream called ${calls.length}x: ${calls.map((u) => u.url).join(' ')}`);
  if (e.url !== undefined && calls[0]?.url !== e.url) out.push(`upstream url ${calls[0]?.url}`);
  if (e.token !== undefined && (calls[0]?.token ?? null) !== e.token) out.push('wrong admin token state');
  if (e.logouts !== undefined && logoutCalls !== e.logouts) out.push(`logouts ${logoutCalls}`);
  if (e.refreshes !== undefined && refreshCalls !== e.refreshes) out.push(`refreshes ${refreshCalls}`);
  return out;
}

async function run() {
  await new Promise((ok) => stub.listen(STUB_PORT, '127.0.0.1', ok));
  if (!process.env.SKIP_BUILD) {
    console.log('building the frontend with dummy values');
    const built = spawnSync('npx', ['next', 'build'], { cwd: FRONTEND, env, stdio: 'ignore' });
    if (built.status !== 0) throw new Error('next build failed');
  }
  const app = spawn('npx', ['next', 'start', '-H', '127.0.0.1', '-p', String(APP_PORT)], {
    cwd: FRONTEND,
    env,
    stdio: 'ignore',
    detached: true,
  });
  const stop = () => {
    try {
      process.kill(-app.pid);
    } catch {
      /* already gone */
    }
  };
  process.on('exit', stop);
  let ready = false;
  for (let i = 0; i < 60 && !ready; i++) {
    ready = await send({ method: 'GET', path: '/login' }).then((r) => r.status === 200);
    if (!ready) await new Promise((ok) => setTimeout(ok, 500));
  }
  if (!ready) throw new Error('next start did not come up');

  // A real asset path, read from the login page, proves static files still load.
  const page = await (await fetch(`${APP}/login`)).text();
  const asset = page.match(/\/_next\/static\/[^"']+\.js/)?.[0];
  if (!asset) throw new Error('no static asset found on /login');
  add(g6, 'GET', asset, { status: [200], upstream: 0 }, { label: 'static js' });

  const results = [];
  let failed = 0;
  for (const c of cases) {
    upstream = [];
    logouts = 0;
    refreshes = 0;
    const got = await send(c);
    await new Promise((ok) => setTimeout(ok, 5));
    const bad = problems(c, got, upstream, logouts, refreshes);
    const session = c.cookie === LOGGED_IN || c.cookie === NEEDS_REFRESH ? 'in' : c.cookie ? 'expired' : 'out';
    const name = `${c.method} ${c.path}${c.label ? ` (${c.label})` : ''} [${session}]`;
    results.push({ group: c.group, name, status: got.status, location: got.location, upstream: upstream.length, ok: bad.length === 0 });
    if (bad.length) {
      failed += 1;
      console.log(`  FAIL ${name}: ${bad.join('; ')}`);
    }
  }
  stop();
  if (process.env.REPORT) writeFileSync(process.env.REPORT, JSON.stringify(results, null, 1));
  console.log(`passed ${results.length - failed}, failed ${failed}`);
  process.exit(failed ? 1 : 0);
}

run().catch((err) => {
  console.error(String(err));
  process.exit(1);
});
