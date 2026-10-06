import { describe, it, expect, vi, afterEach } from 'vitest';
import { createHmac } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { BadRequestException } from '@nestjs/common';
import { FacebookProvider, verifySignedRequest } from './facebook.provider';

const SECRET = 'app-secret';
const args = { code: 'c', codeVerifier: 'verifier', redirectUri: 'https://app.test/cb' };

function provider(env: Record<string, string | undefined> = {}) {
  const values = { FACEBOOK_OAUTH_CLIENT_ID: '123', FACEBOOK_OAUTH_CLIENT_SECRET: SECRET, ...env };
  return new FacebookProvider({
    get: (k: string) => values[k as keyof typeof values],
  } as ConfigService);
}

/** Answers the token call first, then /me. */
function stubFetch(...responses: Array<{ ok?: boolean; status?: number; body: unknown }>) {
  const fn = vi.fn();
  for (const r of responses) {
    const ok = r.ok ?? true;
    fn.mockResolvedValueOnce({
      ok,
      status: r.status ?? (ok ? 200 : 400),
      json: async () => r.body,
    });
  }
  vi.stubGlobal('fetch', fn);
  return fn;
}

function signed(payload: Record<string, unknown>, secret = SECRET) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', secret).update(body).digest('base64url');
  return `${sig}.${body}`;
}

describe('FacebookProvider', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('is configured only when both id and secret are set', () => {
    expect(provider().isConfigured()).toBe(true);
    expect(provider({ FACEBOOK_OAUTH_CLIENT_SECRET: undefined }).isConfigured()).toBe(false);
    expect(provider({ FACEBOOK_OAUTH_CLIENT_ID: '' }).isConfigured()).toBe(false);
  });

  it('builds an authorization URL carrying state, the email scope and the PKCE challenge', () => {
    const url = new URL(
      provider().authorizeUrl({
        state: 'st',
        codeChallenge: 'chal',
        redirectUri: args.redirectUri,
      }),
    );
    expect(url.searchParams.get('state')).toBe('st');
    expect(url.searchParams.get('scope')).toContain('email');
    expect(url.searchParams.get('code_challenge')).toBe('chal');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  });

  it('returns the profile, sending the token as a bearer header', async () => {
    const fetchMock = stubFetch(
      { body: { access_token: 'tok' } },
      { body: { id: 'fb-1', name: 'A', email: 'a@b.c' } },
    );
    expect(await provider().exchange(args)).toEqual({
      subject: 'fb-1',
      email: 'a@b.c',
      name: 'A',
    });
    const tokenUrl = new URL(fetchMock.mock.calls[0][0]);
    expect(tokenUrl.searchParams.get('code_verifier')).toBe('verifier');
    expect(tokenUrl.searchParams.get('client_secret')).toBe(SECRET);
    const [meUrl, meInit] = fetchMock.mock.calls[1];
    expect(new URL(meUrl).searchParams.get('appsecret_proof')).toBe(
      createHmac('sha256', SECRET).update('tok').digest('hex'),
    );
    expect(meInit.headers.authorization).toBe('Bearer tok');
  });

  it('accepts a profile without email (phone-only account)', async () => {
    stubFetch({ body: { access_token: 'tok' } }, { body: { id: 'fb-2', name: 'B' } });
    expect(await provider().exchange(args)).toEqual({ subject: 'fb-2', email: null, name: 'B' });
  });

  it('throws when the token endpoint answers non-2xx', async () => {
    stubFetch({ ok: false, status: 400, body: {} });
    await expect(provider().exchange(args)).rejects.toThrow('token endpoint answered 400');
  });

  it('throws when /me answers non-2xx or has no id', async () => {
    stubFetch({ body: { access_token: 't' } }, { ok: false, status: 500, body: {} });
    await expect(provider().exchange(args)).rejects.toThrow('/me answered 500');
    stubFetch({ body: { access_token: 't' } }, { body: { name: 'x' } });
    await expect(provider().exchange(args)).rejects.toThrow('no id');
  });
});

describe('verifySignedRequest', () => {
  const now = () => Math.floor(Date.now() / 1000);
  const good = { algorithm: 'HMAC-SHA256', user_id: 'fb-9', issued_at: now() };

  it('returns the user id for a good signature', () => {
    expect(verifySignedRequest(signed(good), SECRET)).toBe('fb-9');
  });

  it('rejects a tampered payload', () => {
    const [sig] = signed(good).split('.');
    const forged = Buffer.from(JSON.stringify({ ...good, user_id: 'victim' })).toString(
      'base64url',
    );
    expect(() => verifySignedRequest(`${sig}.${forged}`, SECRET)).toThrow(BadRequestException);
  });

  it('rejects a signature made with another secret', () => {
    expect(() => verifySignedRequest(signed(good, 'other'), SECRET)).toThrow(BadRequestException);
  });

  it('rejects a validly signed payload with another algorithm', () => {
    const token = signed({ ...good, algorithm: 'HMAC-SHA1' });
    expect(() => verifySignedRequest(token, SECRET)).toThrow(BadRequestException);
  });

  it('rejects malformed input and a short signature without throwing anything else', () => {
    for (const bad of ['', 'nodot', 'a.b.c', '.x', 'x.', 'AAAA.' + signed(good).split('.')[1]]) {
      expect(() => verifySignedRequest(bad, SECRET)).toThrow(BadRequestException);
    }
  });

  it('rejects a signature with non-base64url characters even if it decodes to the right bytes', () => {
    const [sig, body] = signed(good).split('.');
    expect(() => verifySignedRequest(`${sig}=.${body}`, SECRET)).toThrow(BadRequestException);
    expect(() => verifySignedRequest(`!${sig}.${body}`, SECRET)).toThrow(BadRequestException);
  });

  it('rejects a replayed (over a day old) or undated signed_request', () => {
    const stale = signed({ ...good, issued_at: now() - 25 * 60 * 60 });
    expect(() => verifySignedRequest(stale, SECRET)).toThrow(BadRequestException);
    const undated = signed({ algorithm: 'HMAC-SHA256', user_id: 'fb-9' });
    expect(() => verifySignedRequest(undated, SECRET)).toThrow(BadRequestException);
  });

  it('rejects a validly signed payload that is not JSON or has no user_id', () => {
    const body = Buffer.from('not json').toString('base64url');
    const sig = createHmac('sha256', SECRET).update(body).digest('base64url');
    expect(() => verifySignedRequest(`${sig}.${body}`, SECRET)).toThrow(BadRequestException);
    expect(() =>
      verifySignedRequest(signed({ algorithm: 'HMAC-SHA256', issued_at: now() }), SECRET),
    ).toThrow(BadRequestException);
  });
});
