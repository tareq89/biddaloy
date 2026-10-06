import { describe, it, expect, vi } from 'vitest';
import { createHmac } from 'crypto';
import type { ConfigService } from '@nestjs/config';
import { SocialProvider } from '@biddaloy/shared';
import { SocialAuthService, safeRedirect } from './social-auth.service';
import type { SocialIdentityService } from './social-identity.service';
import type { SocialProviderClient } from './providers/social-provider';

const BASE = 'https://app.example.com';

describe('safeRedirect', () => {
  it.each(['//evil.com', '/\\evil.com', 'https://evil.com', '/\t/evil.com', '/\n/evil.com'])(
    'rejects %j',
    (value) => {
      expect(safeRedirect(value, BASE)).toBeUndefined();
    },
  );

  it('keeps a same-origin path with query and hash', () => {
    expect(safeRedirect('/dashboard?x=1#a', BASE)).toBe('/dashboard?x=1#a');
  });

  it('returns undefined for no value', () => {
    expect(safeRedirect(undefined, BASE)).toBeUndefined();
  });
});

describe('SocialAuthService.facebookDataDeletion', () => {
  const SECRET = 'fb-secret';
  const CONTEXT = { ip: '127.0.0.1', userAgent: 'test' } as never;

  /** A signed_request the way Meta builds it: base64url(HMAC-SHA256(payload)).payload */
  function signedRequest(): string {
    const payload = Buffer.from(
      JSON.stringify({
        algorithm: 'HMAC-SHA256',
        user_id: 'fb-1',
        issued_at: Math.floor(Date.now() / 1000),
      }),
    ).toString('base64url');
    return `${createHmac('sha256', SECRET).update(payload).digest('base64url')}.${payload}`;
  }

  const FACEBOOK_ON = { name: SocialProvider.FACEBOOK, isConfigured: () => true };

  function build(
    env: Record<string, string>,
    providers = [FACEBOOK_ON] as unknown as SocialProviderClient[],
  ) {
    const deleteBySubject = vi.fn().mockResolvedValue(undefined);
    const config = { get: (key: string) => env[key] } as unknown as ConfigService;
    const service = new SocialAuthService(
      providers,
      {} as never,
      {} as never,
      { deleteBySubject } as unknown as SocialIdentityService,
      {} as never,
      {} as never,
      config,
      {} as never,
    );
    return { service, deleteBySubject };
  }

  it('fails before deleting anything when APP_BASE_URL is missing in production', async () => {
    const { service, deleteBySubject } = build({
      NODE_ENV: 'production',
      FACEBOOK_OAUTH_CLIENT_SECRET: SECRET,
    });

    await expect(service.facebookDataDeletion(signedRequest(), CONTEXT)).rejects.toThrow(
      /APP_BASE_URL/,
    );
    // Business-critical: a config error must not leave the identity already deleted.
    expect(deleteBySubject).not.toHaveBeenCalled();
  });

  it('deletes and answers with the status URL when APP_BASE_URL is valid', async () => {
    const { service, deleteBySubject } = build({
      NODE_ENV: 'production',
      APP_BASE_URL: BASE,
      FACEBOOK_OAUTH_CLIENT_SECRET: SECRET,
    });

    const res = await service.facebookDataDeletion(signedRequest(), CONTEXT);

    expect(deleteBySubject).toHaveBeenCalledWith(
      SocialProvider.FACEBOOK,
      'fb-1',
      res.confirmation_code,
      CONTEXT,
    );
    expect(res.url).toBe(
      `${BASE}/api/v1/auth/social/facebook/data-deletion/status?code=${res.confirmation_code}`,
    );
  });
});
