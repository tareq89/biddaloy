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
import { randomUUID } from 'node:crypto';
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
  const next = argv[i + 1];
  // A flag right after --base-url means the value is missing.
  const raw = (i >= 0 ? (next?.startsWith('--') ? '' : next) : env.SMOKE_BASE_URL) ?? '';
  return raw.replace(/\/+$/, '');
}

/** Pure. 0 all passed, 1 a check failed, 2 bad usage. */
export function exitCode(result) {
  return result.usageError ? 2 : result.failed ? 1 : 0;
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
  const check = async (
    method,
    path,
    label,
    { headers = {}, body, rawBody, expect = 200, ok = () => true } = {},
  ) => {
    const started = Date.now();
    let status = '';
    let json = null;
    let good = false;
    try {
      const res = await fetch(`${baseUrl}${path}`, {
        method,
        headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
        body: rawBody ?? (body ? JSON.stringify(body) : undefined),
        signal: AbortSignal.timeout(10_000),
      });
      status = String(res.status);
      if (res.status === expect) {
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

  // [2650] Always-on rejection rows: the body parser answers before any login is counted.
  const login = '/api/v1/auth/login';
  await check('POST', login, '#2634 413', {
    rawBody: JSON.stringify({ email: 'x@x.test', password: 'x'.repeat(1_200_000) }),
    headers: { 'Content-Type': 'application/json' },
    expect: 413,
  });
  await check('POST', login, '#2634 415', {
    rawBody: '{}',
    headers: { 'Content-Type': 'application/json; charset=bogus' },
    expect: 415,
  });

  // Optional write-rejection rows: each is refused before any write happens.
  // Hard guard: every line carries a 0.01 one-off discount and no approval token is sent.
  // A discount needs a `fees.discount` step-up token, which checkout burns as its last
  // check before writing, so even if the bill became payable again (payment reversed,
  // bill regenerated) the request ends in a 403 and never records a payment.
  const checkout = (label, studentFeeId, amount, expect, ok) =>
    check('POST', '/api/v1/payments/checkout', label, {
      headers: sessions.admin,
      body: {
        idempotency_key: randomUUID(),
        payment_method: 'CASH',
        lines: [{ student_fee_id: studentFeeId, amount, one_off_discount: 0.01 }],
      },
      expect,
      ok,
    });
  if (env.SMOKE_PAID_STUDENT_FEE_ID) {
    await checkout(
      '#2592',
      env.SMOKE_PAID_STUDENT_FEE_ID,
      1,
      409,
      (b) => b.details?.code === 'CHECKOUT_FEE_SETTLED',
    );
  }
  if (env.SMOKE_OPEN_STUDENT_FEE_ID) {
    await checkout('#2636', env.SMOKE_OPEN_STUDENT_FEE_ID, 99999999.99, 400, (b) =>
      String(b.message).includes('outstanding balance'),
    );
  }
  if (env.SMOKE_PARENT_EMAIL && env.SMOKE_PARENT_PASSWORD) {
    const p = await check('POST', login, 'parent', {
      body: { email: env.SMOKE_PARENT_EMAIL, password: env.SMOKE_PARENT_PASSWORD },
      ok: (b) => typeof b.access_token === 'string' && b.memberships?.length > 0,
    });
    if (p) {
      await check('POST', '/api/v1/auth/step-up/otp/request', '#2639', {
        headers: {
          Authorization: `Bearer ${p.access_token}`,
          'X-Tenant-ID': p.memberships[0].tenantId,
          'X-Role': p.memberships[0].role,
        },
        body: { identifier: 'smoke@invalid.test' },
        expect: 403,
      });
    }
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
  process.exit(exitCode(r));
}
