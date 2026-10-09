import { describe, it, expect, vi, afterEach } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { GoogleProvider } from './google.provider';

const CLIENT_ID = 'client-123.apps.googleusercontent.com';
const args = { code: 'c', codeVerifier: 'v', nonce: 'n1', redirectUri: 'https://app.test/cb' };

function provider(env: Record<string, string | undefined> = {}) {
  const values = { GOOGLE_OAUTH_CLIENT_ID: CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET: 's', ...env };
  return new GoogleProvider({
    get: (k: string) => values[k as keyof typeof values],
  } as ConfigService);
}

function idToken(claims: Record<string, unknown>): string {
  const base = {
    iss: 'https://accounts.google.com',
    aud: CLIENT_ID,
    nonce: 'n1',
    sub: 'g-1',
    exp: Math.floor(Date.now() / 1000) + 600,
    ...claims,
  };
  return `h.${Buffer.from(JSON.stringify(base)).toString('base64url')}.s`;
}

function stubFetch(body: unknown, ok = true) {
  const fn = vi.fn(async () => ({ ok, status: ok ? 200 : 400, json: async () => body }));
  vi.stubGlobal('fetch', fn);
  return fn;
}

describe('GoogleProvider', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('is configured only when both id and secret are set', () => {
    expect(provider().isConfigured()).toBe(true);
    expect(provider({ GOOGLE_OAUTH_CLIENT_SECRET: undefined }).isConfigured()).toBe(false);
    expect(provider({ GOOGLE_OAUTH_CLIENT_ID: undefined }).isConfigured()).toBe(false);
  });

  it('builds a PKCE authorization URL carrying state and nonce', () => {
    const url = new URL(
      provider().authorizeUrl({
        state: 'st',
        codeChallenge: 'ch',
        nonce: 'n1',
        redirectUri: 'https://app.test/cb',
      }),
    );
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toBe('ch');
    expect(url.searchParams.get('state')).toBe('st');
    expect(url.searchParams.get('nonce')).toBe('n1');
  });

  it('returns the profile for a good token, sending the verifier', async () => {
    const fetchMock = stubFetch({
      id_token: idToken({ email: 'a@b.c', email_verified: true, name: 'A' }),
    });
    const profile = await provider().exchange(args);
    expect(profile).toEqual({ subject: 'g-1', email: 'a@b.c', name: 'A' });
    expect(
      String(
        (fetchMock.mock.calls[0] as unknown[])[1] &&
          ((fetchMock.mock.calls[0] as unknown[])[1] as { body: URLSearchParams }).body,
      ),
    ).toContain('code_verifier=v');
  });

  it('drops an unverified email', async () => {
    stubFetch({ id_token: idToken({ email: 'a@b.c', email_verified: false }) });
    expect((await provider().exchange(args)).email).toBeNull();
  });

  it('rejects a wrong audience', async () => {
    stubFetch({ id_token: idToken({ aud: 'someone-else' }) });
    await expect(provider().exchange(args)).rejects.toThrow('audience');
  });

  it('rejects a wrong issuer', async () => {
    stubFetch({ id_token: idToken({ iss: 'https://evil.test' }) });
    await expect(provider().exchange(args)).rejects.toThrow('issuer');
  });

  it('rejects an expired token', async () => {
    stubFetch({ id_token: idToken({ exp: Math.floor(Date.now() / 1000) - 5 }) });
    await expect(provider().exchange(args)).rejects.toThrow('expired');
  });

  it('rejects a wrong nonce', async () => {
    stubFetch({ id_token: idToken({ nonce: 'other' }) });
    await expect(provider().exchange(args)).rejects.toThrow('nonce');
  });

  it('rejects a failed token exchange', async () => {
    stubFetch({}, false);
    await expect(provider().exchange(args)).rejects.toThrow('400');
  });
});
