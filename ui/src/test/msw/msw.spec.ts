import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { server } from './server';

// No DOM needed — `server` intercepts real HTTP calls (`fetch`) directly,
// this is pure Node-side behavior. `server.listen`/`resetHandlers`/`close`
// lifecycle is wired globally in ui/src/test/setup.ts, not repeated here.

describe('handler reset between tests', () => {
  // Two tests, deliberately split across `it` blocks rather than combined
  // into one: the whole point is proving setup.ts's afterEach(() =>
  // server.resetHandlers()) actually runs *between* tests, which a single
  // test calling both steps itself couldn't demonstrate.
  it('installs a per-test override', async () => {
    server.use(
      http.get('https://example.test/probe', () => HttpResponse.json({ from: 'override' })),
    );

    const res = await fetch('https://example.test/probe');
    expect(await res.json()).toEqual({ from: 'override' });
  });

  it("does not see the previous test's override — resetHandlers ran between them", async () => {
    await expect(fetch('https://example.test/probe')).rejects.toThrow();
  });
});

describe('an unhandled request fails loudly', () => {
  it('rejects immediately rather than hanging until timeout', async () => {
    await expect(fetch('https://example.test/nothing-handles-this')).rejects.toThrow();
  });
});

describe('per-test handler override is a one-liner', () => {
  it('server.use(...) inside a single test is enough — no extra setup', async () => {
    server.use(http.get('https://example.test/one-liner', () => HttpResponse.text('ok')));

    const res = await fetch('https://example.test/one-liner');
    expect(await res.text()).toBe('ok');
  });
});
