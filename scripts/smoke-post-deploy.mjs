#!/usr/bin/env node
/**
 * [75.33] Post-deploy smoke check. Reads only; the one write is the login
 * itself (one refresh-token row + one audit row per account per run), so use
 * dedicated smoke accounts in production. See docs/architecture/12-operations.md §7.
 *
 *   SMOKE_ADMIN_EMAIL=… SMOKE_ADMIN_PASSWORD=… (teacher, super_admin likewise) \
 *     node scripts/smoke-post-deploy.mjs --base-url https://staging.example.com
 *
 * Credentials come from env only (arguments end up in shell history).
 * Exit 0 = all passed, 1 = a check failed (stops at the first), 2 = bad usage.
 * Output never contains a token, password, email or response body.
 */
import { fileURLToPath } from 'node:url';

const ACCOUNTS = [
  ['admin', 'ADMIN'],
  ['teacher', 'TEACHER'],
  ['super_admin', 'SUPER_ADMIN'],
];

/** Pure. Returns the names of required env vars that are unset/empty. */
export function missingEnv(env) {
  const names = ACCOUNTS.flatMap(([k]) => [
    `SMOKE_${k.toUpperCase()}_EMAIL`,
    `SMOKE_${k.toUpperCase()}_PASSWORD`,
  ]);
  return names.filter((n) => !env[n]);
}

/** Pure. `--base-url X` else SMOKE_BASE_URL, trailing slashes stripped. */
export function resolveBaseUrl(argv, env) {
  const i = argv.indexOf('--base-url');
  const raw = (i >= 0 ? argv[i + 1] : env.SMOKE_BASE_URL) ?? '';
  return raw.replace(/\/+$/, '');
}

export async function runSmoke({ baseUrl, env, fetch, log = () => {} }) {
  const result = { passed: 0, failed: 0, lines: [], usageError: null };
  const out = (line) => {
    result.lines.push(line);
    log(line);
  };
  const missing = missingEnv(env);
  if (!baseUrl) missing.unshift('--base-url (or SMOKE_BASE_URL)');
  if (missing.length) {
    result.usageError = `usage: smoke-post-deploy --base-url <url>; missing: ${missing.join(', ')}`;
    out(result.usageError);
    return result;
  }

  /** One check. Returns the parsed JSON body on success, or null after logging FAIL. */
  const check = async (method, path, label, { headers = {}, body, ok = () => true } = {}) => {
    const started = Date.now();
    let status = '';
    let json = null;
    let good = false;
    try {
      const res = await fetch(`${baseUrl}${path}`, {
        method,
        headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(10_000),
      });
      status = String(res.status);
      if (res.status === 200) {
        json = await res.json().catch(() => undefined);
        good = json !== undefined && ok(json);
      }
    } catch (e) {
      status = e?.name === 'TimeoutError' ? 'timeout' : 'network error';
    }
    const ms = Date.now() - started;
    const tag = label ? ` (${label})` : '';
    out(`${good ? 'PASS' : 'FAIL'}  ${method.padEnd(4)} ${path}${tag}  ${status}  ${ms}ms`);
    if (good) result.passed++;
    else result.failed++;
    return good ? json : null;
  };

  const done = () => {
    out(`smoke: ${result.passed}/${result.passed + result.failed} passed`);
    return result;
  };

  if ((await check('GET', '/api/health', '')) === null) return done();

  const sessions = {};
  for (const [key, role] of ACCOUNTS) {
    const up = `SMOKE_${key.toUpperCase()}`;
    const body = await check('POST', '/api/v1/auth/login', key, {
      body: { email: env[`${up}_EMAIL`], password: env[`${up}_PASSWORD`] },
      ok: (b) => typeof b.access_token === 'string' && b.memberships?.some((m) => m.role === role),
    });
    if (!body) return done();
    const m = body.memberships.find((x) => x.role === role);
    sessions[key] = {
      Authorization: `Bearer ${body.access_token}`,
      'X-Tenant-ID': m.tenantId,
      'X-Role': role,
    };
  }

  const reads = [
    ['/api/v1/students?limit=1', 'teacher'],
    ['/api/v1/fees/dues?limit=1', 'admin'],
    ['/api/v1/schools', 'super_admin'],
  ];
  for (const [path, who] of reads) {
    if ((await check('GET', path, who, { headers: sessions[who] })) === null) return done();
  }

  if (env.SMOKE_HEALTH_TOKEN) {
    await check('GET', '/api/health/ready', '', {
      headers: { 'X-Health-Token': env.SMOKE_HEALTH_TOKEN },
      ok: (b) => b.status === 'ok' || b.status === 'degraded',
    });
  }
  return done();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const baseUrl = resolveBaseUrl(process.argv.slice(2), process.env);
  const r = await runSmoke({
    baseUrl,
    env: process.env,
    fetch: globalThis.fetch,
    log: console.log,
  });
  process.exit(r.usageError ? 2 : r.failed ? 1 : 0);
}
