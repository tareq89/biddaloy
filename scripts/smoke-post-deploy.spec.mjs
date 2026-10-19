import { describe, expect, it } from 'vitest';

import { exitCode, resolveBaseUrl, runSmoke } from './smoke-post-deploy.mjs';

const ENV = {
  SMOKE_ADMIN_EMAIL: 'adm@x.test',
  SMOKE_ADMIN_PASSWORD: 'pw-admin-secret',
  SMOKE_TEACHER_EMAIL: 'tea@x.test',
  SMOKE_TEACHER_PASSWORD: 'pw-teacher-secret',
  SMOKE_SUPER_ADMIN_EMAIL: 'sup@x.test',
  SMOKE_SUPER_ADMIN_PASSWORD: 'pw-super-secret',
};
const TOKEN = 'tok-SECRET-123';
const json = (status, body) => ({ status, json: async () => body });
const ROLE_BY_EMAIL = {
  'adm@x.test': 'ADMIN',
  'tea@x.test': 'TEACHER',
  'sup@x.test': 'SUPER_ADMIN',
};

/** Fake fetch; `overrides` maps "METHOD path" to a response. */
function fakeFetch(overrides = {}) {
  const calls = [];
  const fn = async (url, init) => {
    const key = `${init.method} ${url.replace('https://x.test', '')}`;
    calls.push(key);
    if (key === 'POST /api/v1/auth/login') {
      // The always-on body-parser rows: oversize body 413, bogus charset 415.
      if (init.body.length > 1_000_000) return json(413, {});
      if (init.headers['Content-Type'].includes('bogus')) return json(415, {});
    }
    if (key in overrides) return overrides[key];
    if (key === 'POST /api/v1/payments/checkout') {
      const amount = JSON.parse(init.body).lines[0].amount;
      return amount > 1000
        ? json(400, { message: 'The amount is more than the outstanding balance' })
        : json(409, { details: { code: 'CHECKOUT_FEE_SETTLED' } });
    }
    if (key === 'POST /api/v1/auth/step-up/otp/request') return json(403, {});
    if (key === 'POST /api/v1/auth/login') {
      const role = ROLE_BY_EMAIL[JSON.parse(init.body).email] ?? 'PARENT';
      return json(200, { access_token: TOKEN, memberships: [{ role, tenantId: 't1' }] });
    }
    if (key === 'GET /api/health/ready') return json(200, { status: 'ok' });
    return json(200, key === 'GET /api/health' ? { status: 'ok' } : []);
  };
  fn.calls = calls;
  return fn;
}

const run = (fetch, env = ENV, baseUrl = 'https://x.test') => runSmoke({ baseUrl, env, fetch });

describe('smoke-post-deploy', () => {
  it('passes all 9 checks', async () => {
    const r = await run(fakeFetch());
    expect(r.passed).toBe(9);
    expect(r.failed).toBe(0);
    expect(r.lines.at(-1)).toBe('smoke: 9/9 passed');
  });

  it('stops at a failed admin login', async () => {
    const f = fakeFetch();
    const r = await run(async (u, i) =>
      i.method === 'POST' && JSON.parse(i.body).email === 'adm@x.test' ? json(401, {}) : f(u, i),
    );
    expect(r.failed).toBe(1);
    expect(r.passed).toBe(1); // only /health
    const fails = r.lines.filter((l) => l.startsWith('FAIL'));
    expect(fails).toHaveLength(1);
    expect(fails[0]).toContain('(admin)');
  });

  it('fails when the teacher list is denied', async () => {
    const r = await run(fakeFetch({ 'GET /api/v1/students?limit=1': json(403, {}) }));
    expect(r.failed).toBe(1);
    expect(r.lines.find((l) => l.startsWith('FAIL'))).toContain('(teacher)  403');
  });

  it('passes on an empty teacher list', async () => {
    const r = await run(fakeFetch({ 'GET /api/v1/students?limit=1': json(200, []) }));
    expect(r.failed).toBe(0);
  });

  it('reports a missing env var without calling fetch', async () => {
    const f = fakeFetch();
    const { SMOKE_TEACHER_PASSWORD: _omit, ...env } = ENV;
    const r = await run(f, env);
    expect(r.usageError).toContain('SMOKE_TEACHER_PASSWORD');
    expect(f.calls).toHaveLength(0);
  });

  it('does not double the slash for a trailing-slash base url', async () => {
    const baseUrl = resolveBaseUrl(['--base-url', 'https://x.test/'], {});
    expect(baseUrl).toBe('https://x.test');
    const f = fakeFetch();
    await run(f, ENV, baseUrl);
    expect(f.calls[0]).toBe('GET /api/health');
  });

  it('never prints token, passwords or emails', async () => {
    const r = await run(fakeFetch());
    const out = r.lines.join('\n');
    for (const secret of [TOKEN, ...Object.values(ENV)]) expect(out).not.toContain(secret);
  });

  it('reports TimeoutError as timeout', async () => {
    const r = await run(async () => {
      throw Object.assign(new Error('t'), { name: 'TimeoutError' });
    });
    expect(r.lines[0]).toMatch(/^FAIL .*timeout/);
  });

  it('runs readiness only when SMOKE_HEALTH_TOKEN is set', async () => {
    const a = fakeFetch();
    await run(a);
    expect(a.calls).not.toContain('GET /api/health/ready');
    const b = fakeFetch();
    const r = await run(b, { ...ENV, SMOKE_HEALTH_TOKEN: 'h' });
    expect(b.calls).toContain('GET /api/health/ready');
    expect(r.passed).toBe(10);
  });

  const OPT = {
    paid: { SMOKE_PAID_STUDENT_FEE_ID: 'f1' },
    open: { SMOKE_OPEN_STUDENT_FEE_ID: 'f2' },
    parent: { SMOKE_PARENT_EMAIL: 'par@x.test', SMOKE_PARENT_PASSWORD: 'pw-parent-secret' },
  };
  const CHECKOUT = 'POST /api/v1/payments/checkout';
  const STEP_UP = 'POST /api/v1/auth/step-up/otp/request';

  it('the optional rows are not called when their variables are unset', async () => {
    const f = fakeFetch();
    await run(f);
    expect(f.calls).not.toContain(CHECKOUT);
    expect(f.calls).not.toContain(STEP_UP);
  });

  it.each([
    ['paid', '#2592', CHECKOUT, json(200, {}), 1],
    ['open', '#2636', CHECKOUT, json(409, {}), 1],
    ['parent', '#2639', STEP_UP, json(200, {}), 2],
  ])(
    'optional row %s passes on the expected status and fails otherwise',
    async (k, tag, key, wrong, extra) => {
      const env = { ...ENV, ...OPT[k] };
      const ok = await run(fakeFetch(), env);
      expect(ok.failed).toBe(0);
      expect(ok.passed).toBe(9 + extra);
      expect(ok.lines.join('\n')).toContain(tag);
      const bad = await run(fakeFetch({ [key]: wrong }), env);
      expect(bad.failed).toBe(1);
      expect(bad.lines.find((l) => l.startsWith('FAIL'))).toContain(tag);
    },
  );

  it('#2592/#2636 checkout rows can never write: a discount line and no approval token', async () => {
    const bodies = [];
    const f = fakeFetch();
    const spy = async (url, init) => {
      if (url.endsWith('/api/v1/payments/checkout')) bodies.push(init);
      return f(url, init);
    };
    await run(spy, { ...ENV, ...OPT.paid, ...OPT.open });
    expect(bodies).toHaveLength(2);
    for (const init of bodies) {
      expect(JSON.parse(init.body).lines.every((l) => l.one_off_discount > 0)).toBe(true);
      expect(Object.keys(init.headers).map((h) => h.toLowerCase())).not.toContain(
        'x-approval-token',
      );
    }
  });

  it('never prints parent credentials', async () => {
    const r = await run(fakeFetch(), { ...ENV, ...OPT.parent });
    const out = r.lines.join('\n');
    for (const v of Object.values(OPT.parent)) expect(out).not.toContain(v);
  });

  it('falls back to SMOKE_BASE_URL', () => {
    expect(resolveBaseUrl([], { SMOKE_BASE_URL: 'https://y.test/' })).toBe('https://y.test');
  });

  it('treats --base-url followed by a flag, or nothing, as missing', async () => {
    expect(resolveBaseUrl(['--base-url', '--x'], {})).toBe('');
    const f = fakeFetch();
    const r = await runSmoke({ baseUrl: '', env: ENV, fetch: f });
    expect(r.usageError).toContain('--base-url');
    expect(f.calls).toHaveLength(0);
  });

  it('maps results to exit codes', async () => {
    expect(exitCode(await run(fakeFetch()))).toBe(0);
    expect(exitCode(await run(fakeFetch({ 'GET /api/health': json(500, {}) })))).toBe(1);
    expect(exitCode(await runSmoke({ baseUrl: '', env: {}, fetch: fakeFetch() }))).toBe(2);
  });

  it('fails readiness on 503', async () => {
    const r = await run(fakeFetch({ 'GET /api/health/ready': json(503, {}) }), {
      ...ENV,
      SMOKE_HEALTH_TOKEN: 'h',
    });
    expect(r.failed).toBe(1);
    expect(r.lines.find((l) => l.startsWith('FAIL'))).toContain('503');
  });

  it('labels a rejected fetch as network error', async () => {
    const r = await run(async () => {
      throw new TypeError('fetch failed');
    });
    expect(r.lines[0]).toMatch(/^FAIL .*network error/);
  });

  it('fails a 200 with a non-JSON body', async () => {
    const bad = {
      status: 200,
      json: async () => {
        throw new SyntaxError('x');
      },
    };
    const r = await run(fakeFetch({ 'GET /api/health': bad }));
    expect(r.failed).toBe(1);
  });
});
