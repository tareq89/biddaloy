import { describe, expect, it } from 'vitest';

import { resolveBaseUrl, runSmoke } from './smoke-post-deploy.mjs';

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
    if (key in overrides) return overrides[key];
    if (key === 'POST /api/v1/auth/login') {
      const role = ROLE_BY_EMAIL[JSON.parse(init.body).email];
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
  it('passes all 7 checks', async () => {
    const r = await run(fakeFetch());
    expect(r.passed).toBe(7);
    expect(r.failed).toBe(0);
    expect(r.lines.at(-1)).toBe('smoke: 7/7 passed');
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
    expect(r.passed).toBe(8);
  });
});
