import { describe, expect, it } from 'vitest';

import {
  exitCode,
  hasFreshMessage,
  inboxSearchUrl,
  inboxSmsSearchUrl,
  pollUntil,
  resolveBaseUrl,
  runSmoke,
  smokeDeviceCookie,
  totpCode,
} from './smoke-post-deploy.mjs';

const ENV = {
  SMOKE_ADMIN_EMAIL: 'adm@x.test',
  SMOKE_ADMIN_PASSWORD: 'pw-admin-secret',
  SMOKE_TEACHER_EMAIL: 'tea@x.test',
  SMOKE_TEACHER_PASSWORD: 'pw-teacher-secret',
};
const TOKEN = 'tok-SECRET-123';
const json = (status, body) => ({ status, json: async () => body });
const ROLE_BY_EMAIL = {
  'adm@x.test': 'ADMIN',
  'tea@x.test': 'TEACHER',
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
      expect(ok.passed).toBe(7 + extra);
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

  it('[2664] #2639 step-up probe uses the PARENT membership, not memberships[0]', async () => {
    const headers = [];
    const f = fakeFetch();
    const spy = async (url, init) => {
      if (url.endsWith('/api/v1/auth/step-up/otp/request')) headers.push(init.headers);
      if (init.method === 'POST' && init.body?.includes?.('par@x.test')) {
        return json(200, {
          access_token: TOKEN,
          memberships: [
            { role: 'ADMIN', tenantId: 't-staff' },
            { role: 'PARENT', tenantId: 't-parent' },
          ],
        });
      }
      return f(url, init);
    };
    const r = await run(spy, { ...ENV, ...OPT.parent });
    expect(r.failed).toBe(0);
    expect(headers).toEqual([
      expect.objectContaining({ 'X-Tenant-ID': 't-parent', 'X-Role': 'PARENT' }),
    ]);
  });

  it('[2664] #2639 parent login with no PARENT membership is a FAIL, not a staff probe', async () => {
    const f = fakeFetch();
    const spy = async (url, init) =>
      init.method === 'POST' && init.body?.includes?.('par@x.test')
        ? json(200, { access_token: TOKEN, memberships: [{ role: 'ADMIN', tenantId: 't1' }] })
        : f(url, init);
    const r = await run(spy, { ...ENV, ...OPT.parent });
    expect(r.failed).toBe(1);
    expect(r.lines.find((l) => l.startsWith('FAIL'))).toContain('(parent)');
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

  describe('inbox check (Epic 87, D25)', () => {
    const INBOX = { ...ENV, SMOKE_INBOX_API_URL: 'http://staging-mailpit:8025' };
    const fresh = {
      messages_count: 1,
      messages: [{ Created: new Date(Date.now() + 60_000).toISOString() }],
    };

    it('encodes the email in the search URL', () => {
      expect(inboxSearchUrl('http://m:8025/', 'a+b@x.test')).toBe(
        'http://m:8025/api/v1/search?query=to%3Aa%2Bb%40x.test',
      );
    });

    it('pollUntil stops at the first hit', async () => {
      let calls = 0;
      const ok = await pollUntil(async () => ++calls === 3, {
        sleep: async () => {},
        now: () => 0,
      });
      expect(ok).toBe(true);
      expect(calls).toBe(3);
    });

    it('pollUntil times out at the deadline', async () => {
      let t = 0;
      const ok = await pollUntil(async () => false, {
        intervalMs: 2000,
        timeoutMs: 6000,
        sleep: async (ms) => void (t += ms),
        now: () => t,
      });
      expect(ok).toBe(false);
      expect(t).toBe(6000);
    });

    it('hasFreshMessage ignores old messages and the mailbox-wide total', () => {
      expect(hasFreshMessage({ total: 5, messages_count: 0, messages: [] }, 0)).toBe(false);
      expect(
        hasFreshMessage(
          { messages_count: 1, messages: [{ Created: '2020-01-01T00:00:00Z' }] },
          Date.now(),
        ),
      ).toBe(false);
      expect(hasFreshMessage(fresh, Date.now())).toBe(true);
    });

    it('skips with one line when the key is unset', async () => {
      const r = await run(fakeFetch());
      expect(r.lines).toContain('inbox: skipped (no SMOKE_INBOX_API_URL)');
      expect(r.failed).toBe(0);
    });

    it('passes when the message shows up, without printing the email', async () => {
      const f = fakeFetch({
        'POST /api/v1/auth/forgot-password': json(202, {}),
        'GET http://staging-mailpit:8025/api/v1/search?query=to%3Aadm%40x.test': json(200, fresh),
      });
      const r = await run(f, INBOX);
      expect(r.failed).toBe(0);
      expect(r.lines.find((l) => l.includes('inbox:'))).toMatch(/^PASS {2}inbox: ok/);
      expect(r.lines.join('\n')).not.toContain('adm@x.test');
    });

    it('passes on a fresh SMS-tagged message (reset sent as an SMS code)', async () => {
      expect(inboxSmsSearchUrl('http://staging-mailpit:8025/')).toBe(
        'http://staging-mailpit:8025/api/v1/search?query=tag%3ASMS',
      );
      const f = fakeFetch({
        'POST /api/v1/auth/forgot-password': json(202, {}),
        'GET http://staging-mailpit:8025/api/v1/search?query=to%3Aadm%40x.test': json(200, {
          messages_count: 0,
          messages: [],
        }),
        'GET http://staging-mailpit:8025/api/v1/search?query=tag%3ASMS': json(200, fresh),
      });
      const r = await run(f, INBOX);
      expect(r.failed).toBe(0);
      expect(r.lines.find((l) => l.includes('inbox:'))).toMatch(/^PASS {2}inbox: ok/);
    });

    it('skips, not fails, when the reset request is rate limited (429)', async () => {
      const r = await run(fakeFetch({ 'POST /api/v1/auth/forgot-password': json(429, {}) }), INBOX);
      expect(r.failed).toBe(0);
      expect(r.lines).toContain('inbox: skipped (reset not mailed: rate limited)');
    });

    it('fails with a line naming the inbox check when the reset request is refused', async () => {
      const r = await run(fakeFetch({ 'POST /api/v1/auth/forgot-password': json(500, {}) }), INBOX);
      expect(r.failed).toBe(1);
      expect(r.lines.find((l) => l.startsWith('FAIL'))).toContain('inbox:');
    });
  });

  describe('moduleRefusal (Epic 77, D10)', () => {
    const PATH = '/api/v1/fees';
    const ON = { ...ENV, SMOKE_MODULE_OFF_PATH: PATH };
    const out = (r) => JSON.stringify(r);
    it('passes on the exact fixed sentence', async () => {
      const f = fakeFetch({
        [`GET ${PATH}`]: json(403, { message: 'This part is not turned on for your institution' }),
      });
      expect(out(await run(f, ON))).not.toContain('FAIL  moduleRefusal');
      expect(f.calls).toContain(`GET ${PATH}`);
    });
    it('fails on any other 403 text', async () => {
      const f = fakeFetch({ [`GET ${PATH}`]: json(403, { message: 'Requires permission(s): X' }) });
      expect(exitCode(await run(f, ON))).toBe(1);
    });
    it('is skipped when SMOKE_MODULE_OFF_PATH is unset', async () => {
      const f = fakeFetch();
      await run(f);
      expect(f.calls).not.toContain(`GET ${PATH}`);
    });
  });

  describe('cockpit fence', () => {
    const FENCE = { ...ENV, SMOKE_COCKPIT_DOMAIN: 'cockpit.test', SMOKE_APP_DOMAIN: 'app.test' };
    const GOOD = {
      'GET https://cockpit.test/api/v1/platform/alerts': 401,
      'GET https://app.test/api/v1/platform/alerts': 404,
      'POST https://app.test/api/v1/auth/cockpit/login': 404,
      'GET https://cockpit.test/': 200,
    };
    /** Routes the four fence URLs by full URL; everything else goes to the normal fake. */
    const fenceFetch = (over = {}) => {
      const table = { ...GOOD, ...over };
      const base = fakeFetch();
      const fn = async (url, init) => {
        const key = `${init.method} ${url}`;
        if (!(key in table)) return base(url, init);
        if (table[key] === 'reset')
          throw new TypeError('fetch failed', { cause: { code: 'ECONNRESET' } });
        if (table[key] === 'dns')
          throw new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } });
        if (table[key] === 302) return new Response(null, { status: 302 });
        return json(table[key], {});
      };
      fn.calls = base.calls;
      return fn;
    };
    const fails = (r) => r.lines.filter((l) => l.startsWith('FAIL'));

    it('skips when SMOKE_COCKPIT_DOMAIN is unset', async () => {
      const r = await run(fakeFetch());
      expect(r.failed).toBe(0);
      expect(r.lines).toContain('cockpit fence: skipped: SMOKE_COCKPIT_DOMAIN not set');
    });

    it('passes all four checks', async () => {
      const r = await run(fenceFetch(), FENCE);
      expect(fails(r)).toHaveLength(0);
      expect(r.failed).toBe(0);
      expect(r.passed).toBe(11);
    });

    it.each([
      ['GET https://cockpit.test/api/v1/platform/alerts', 200, 'alerts on cockpit host'],
      ['GET https://cockpit.test/api/v1/platform/alerts', 404, 'alerts on cockpit host'],
      ['GET https://app.test/api/v1/platform/alerts', 401, 'alerts on app host'],
      ['GET https://app.test/api/v1/platform/alerts', 200, 'alerts on app host'],
      ['GET https://app.test/api/v1/platform/alerts', 403, 'alerts on app host'],
      ['GET https://app.test/api/v1/platform/alerts', 302, 'alerts on app host'],
      ['POST https://app.test/api/v1/auth/cockpit/login', 401, 'cockpit login on app host'],
      ['POST https://app.test/api/v1/auth/cockpit/login', 403, 'cockpit login on app host'],
      ['POST https://app.test/api/v1/auth/cockpit/login', 200, 'cockpit login on app host'],
      ['GET https://cockpit.test/', 404, 'cockpit shell'],
    ])('fails on %s answering %i', async (key, status, name) => {
      const r = await run(fenceFetch({ [key]: status }), FENCE);
      expect(fails(r)).toHaveLength(1);
      expect(fails(r)[0]).toContain(name);
    });

    it('counts a network reset on the app host as refused', async () => {
      const r = await run(
        fenceFetch({
          'GET https://app.test/api/v1/platform/alerts': 'reset',
          'POST https://app.test/api/v1/auth/cockpit/login': 'reset',
        }),
        FENCE,
      );
      expect(r.failed).toBe(0);
    });

    it('fails on a DNS error on the app host (not a refusal)', async () => {
      const r = await run(
        fenceFetch({ 'GET https://app.test/api/v1/platform/alerts': 'dns' }),
        FENCE,
      );
      expect(fails(r)).toHaveLength(1);
      expect(fails(r)[0]).toContain('alerts on app host');
    });

    it('probes SMOKE_FENCE_ORIGIN with the intended Host header when set', async () => {
      const seen = [];
      const base = fenceFetch({
        'GET http://nginx:80/api/v1/platform/alerts': 401,
        'POST http://nginx:80/api/v1/auth/cockpit/login': 404,
        'GET http://nginx:80/': 200,
      });
      const f = async (url, init) => {
        if (url.startsWith('http://nginx:80')) seen.push([init.method, url, init.headers?.Host]);
        return base(url, init);
      };
      f.calls = base.calls;
      // Same URL answers per Host: the cockpit host knows alerts, the app host refuses.
      const byHost = async (url, init) => {
        if (url === 'http://nginx:80/api/v1/platform/alerts' && init.headers?.Host === 'app.test') {
          seen.push([init.method, url, 'app.test']);
          return new Response(null, { status: 404 });
        }
        return f(url, init);
      };
      byHost.calls = base.calls;
      const r = await run(byHost, { ...FENCE, SMOKE_FENCE_ORIGIN: 'http://nginx:80/' });
      expect(fails(r)).toHaveLength(0);
      expect(seen).toContainEqual(['GET', 'http://nginx:80/api/v1/platform/alerts', 'app.test']);
      expect(seen).toContainEqual(['GET', 'http://nginx:80/', 'cockpit.test']);
    });

    it('fails once when the cockpit domain is set without the app domain', async () => {
      const r = await run(fenceFetch(), { ...FENCE, SMOKE_APP_DOMAIN: undefined });
      expect(fails(r)).toEqual(['FAIL  cockpit fence: SMOKE_APP_DOMAIN not set']);
      expect(r.failed).toBe(1);
    });

    it('fails when the cockpit host itself is unreachable', async () => {
      const r = await run(fenceFetch({ 'GET https://cockpit.test/': 'reset' }), FENCE);
      expect(fails(r)).toHaveLength(1);
    });
  });
  describe('impersonation fence', () => {
    const IMP = {
      ...ENV,
      SMOKE_IMPERSONATION: '1',
      SMOKE_COCKPIT_DOMAIN: 'cockpit.test',
      SMOKE_APP_DOMAIN: 'app.test',
    };
    const EX = 'POST https://app.test/api/v1/auth/impersonation/exchange';
    const COCK = 'POST https://cockpit.test/api/v1/platform/impersonation';
    const APP = 'POST https://app.test/api/v1/platform/impersonation';
    const GOOD = { [EX]: 401, [COCK]: 401, [APP]: 404 };
    const impFetch = (over = {}) => {
      const table = { ...GOOD, ...over };
      const base = fakeFetch();
      const fn = async (url, init) => {
        const key = `${init.method} ${url}`;
        if (!(key in table)) return base(url, init);
        if (table[key] === 'reset')
          throw new TypeError('fetch failed', { cause: { code: 'ECONNRESET' } });
        return json(table[key], { access_token: 'LEAK-BODY' });
      };
      fn.calls = base.calls;
      return fn;
    };
    const fails = (r) =>
      r.lines.filter((l) => l.startsWith('FAIL') && l.includes('impersonation fence'));

    it('skips unless SMOKE_IMPERSONATION is 1', async () => {
      const r = await run(fakeFetch(), { ...IMP, SMOKE_IMPERSONATION: undefined });
      expect(fails(r)).toHaveLength(0);
      expect(r.lines).toContain('impersonation fence: skipped: SMOKE_IMPERSONATION not set');
    });

    it('passes all three checks', async () => {
      const r = await run(impFetch(), IMP);
      expect(fails(r)).toHaveLength(0);
      expect(r.lines.filter((l) => l.startsWith('PASS  impersonation fence'))).toHaveLength(3);
    });

    it.each([
      [EX, 200, 'bogus code on app host'],
      [EX, 500, 'bogus code on app host'],
      [EX, 404, 'bogus code on app host'],
      [COCK, 200, 'start without token on cockpit host'],
      [COCK, 403, 'start without token on cockpit host'],
      [COCK, 404, 'start without token on cockpit host'],
      [APP, 200, 'start on app host'],
      [APP, 401, 'start on app host'],
      [APP, 403, 'start on app host'],
    ])('fails on %s answering %i', async (key, status, name) => {
      const r = await run(impFetch({ [key]: status }), IMP);
      expect(fails(r)).toHaveLength(1);
      expect(fails(r)[0]).toContain(name);
    });

    it('counts a network reset on the app host start route as refused', async () => {
      const r = await run(impFetch({ [APP]: 'reset' }), IMP);
      expect(fails(r)).toHaveLength(0);
      expect(r.lines).toContain('PASS  impersonation fence: start on app host  closed');
    });

    it('fails when a domain is missing', async () => {
      const r = await run(impFetch(), { ...IMP, SMOKE_APP_DOMAIN: undefined });
      expect(fails(r)).toHaveLength(1);
    });

    it('sends the 43-char code as JSON to the exchange route', async () => {
      const f = impFetch();
      let sent;
      const spy = async (url, init) => {
        if (`${init.method} ${url}` === EX) sent = init;
        return f(url, init);
      };
      spy.calls = f.calls;
      await run(spy, IMP);
      expect(JSON.parse(sent.body)).toEqual({ code: 'A'.repeat(43) });
      expect(sent.headers['Content-Type']).toBe('application/json');
    });

    it('never prints the code or a response body', async () => {
      const r = await run(impFetch({ [EX]: 200 }), IMP);
      const out = r.lines.join('\n');
      expect(out).not.toContain('AAAAAAAAAA');
      expect(out).not.toContain('LEAK-BODY');
    });
  });

  describe('cockpit sign-in (staging only, D17)', () => {
    const SECRET = 'JBSWY3DPEHPK3PXP';
    const STAGING = {
      ...ENV,
      ENV_NAME: 'staging',
      SMOKE_COCKPIT_EMAIL: 'own@x.test',
      SMOKE_COCKPIT_PASSWORD: 'pw-cockpit-secret',
      SMOKE_COCKPIT_TOTP_SECRET: SECRET,
    };
    const API = '/api/v1/auth/cockpit';
    /** Fake cockpit: records the mfa request headers/body and the calls. */
    const cockpitFetch = (over = {}) => {
      const seen = {};
      const base = fakeFetch();
      const calls = [];
      const fn = async (url, init) => {
        const key = `${init.method} ${url.replace('https://x.test', '')}`;
        calls.push(key);
        if (key in over) return over[key];
        if (key === `POST ${API}/login`) return json(200, { step: 'mfa', mfaToken: 'mfa-tok' });
        if (key === `POST ${API}/mfa`) {
          seen.mfa = { headers: init.headers, body: JSON.parse(init.body) };
          return {
            status: 200,
            json: async () => ({ step: 'done', access_token: TOKEN }),
            headers: { getSetCookie: () => ['__Host-cockpit_refresh=r1; Path=/; HttpOnly'] },
          };
        }
        if (key === 'GET /api/v1/platform/owners') {
          seen.ownersAuth = init.headers.Authorization;
          return json(200, []);
        }
        if (key === `POST ${API}/logout`) {
          seen.logoutCookie = init.headers.Cookie;
          return { status: 204, json: async () => undefined };
        }
        return base(url, init);
      };
      fn.seen = seen;
      fn.calls = calls;
      return fn;
    };

    it('signs in with a code and the smoke device, reads owners, signs out', async () => {
      const f = cockpitFetch();
      // Freeze the clock so the runner and the assertion share one 30s TOTP step.
      const now = vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
      let r;
      try {
        r = await run(f, STAGING);
      } finally {
        now.mockRestore();
      }
      expect(r.failed).toBe(0);
      expect(r.passed).toBe(7 + 4);
      expect(f.seen.mfa.body).toEqual({
        mfaToken: 'mfa-tok',
        code: totpCode(SECRET, 1_700_000_000_000),
      });
      expect(f.seen.mfa.headers.Cookie).toBe(`__Host-cockpit_device=${smokeDeviceCookie(SECRET)}`);
      expect(f.seen.ownersAuth).toBe(`Bearer ${TOKEN}`);
      expect(f.seen.logoutCookie).toBe('__Host-cockpit_refresh=r1');
    });

    it('is skipped when ENV_NAME is not staging, even with the variables set', async () => {
      const f = cockpitFetch();
      const r = await run(f, { ...STAGING, ENV_NAME: 'production' });
      expect(r.failed).toBe(0);
      expect(f.calls.length).toBeGreaterThan(0);
      expect(f.calls.some((c) => c.includes('/auth/cockpit/'))).toBe(false);
    });

    it('fails when the owners read is refused', async () => {
      const r = await run(cockpitFetch({ 'GET /api/v1/platform/owners': json(403, {}) }), STAGING);
      expect(r.failed).toBe(1);
    });

    it('fails without a cookie on the mfa answer', async () => {
      const r = await run(
        cockpitFetch({
          [`POST ${API}/mfa`]: {
            status: 200,
            json: async () => ({ step: 'done', access_token: TOKEN }),
          },
        }),
        STAGING,
      );
      expect(r.failed).toBe(1);
    });

    it('fails and names the missing variables', async () => {
      const r = await run(cockpitFetch(), { ...STAGING, SMOKE_COCKPIT_TOTP_SECRET: '' });
      expect(r.lines.some((l) => l.includes('missing SMOKE_COCKPIT_TOTP_SECRET'))).toBe(true);
    });

    it('totpCode matches the RFC 6238 SHA-1 vector', () => {
      // RFC 6238 appendix B, T=59s: 94287082 -> last six digits with the ASCII secret in base32.
      expect(totpCode('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 59_000)).toBe('287082');
    });
  });
});
