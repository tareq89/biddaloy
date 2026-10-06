import { BadRequestException, Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { SocialProvider } from '@biddaloy/shared';
import type { SocialProfile, SocialProviderClient } from './social-provider';

const GRAPH = 'https://graph.facebook.com/v19.0';
const AUTH_URL = 'https://www.facebook.com/v19.0/dialog/oauth';

/**
 * Authorization-code flow with PKCE (D37); the `state` (bound to the browser)
 * is the CSRF guard. Facebook has no id_token and no nonce, so the identity is the Graph
 * API `id` read over a direct TLS call. `email` is often absent (phone-only
 * accounts) — that is fine, the identity is the `id`.
 */
@Injectable()
export class FacebookProvider implements SocialProviderClient {
  readonly name = SocialProvider.FACEBOOK;

  constructor(private readonly config: ConfigService) {}

  private get clientId(): string | undefined {
    return this.config.get<string>('FACEBOOK_OAUTH_CLIENT_ID') || undefined;
  }

  private get clientSecret(): string | undefined {
    return this.config.get<string>('FACEBOOK_OAUTH_CLIENT_SECRET') || undefined;
  }

  isConfigured(): boolean {
    return !!this.clientId && !!this.clientSecret;
  }

  authorizeUrl(args: { state: string; codeChallenge: string; redirectUri: string }): string {
    const url = new URL(AUTH_URL);
    url.search = new URLSearchParams({
      client_id: this.clientId ?? '',
      redirect_uri: args.redirectUri,
      response_type: 'code',
      scope: 'public_profile,email',
      state: args.state,
      code_challenge: args.codeChallenge,
      code_challenge_method: 'S256',
    }).toString();
    return url.toString();
  }

  async exchange(args: {
    code: string;
    codeVerifier: string;
    redirectUri: string;
  }): Promise<SocialProfile> {
    const tokenRes = await fetch(
      `${GRAPH}/oauth/access_token?${new URLSearchParams({
        client_id: this.clientId ?? '',
        client_secret: this.clientSecret ?? '',
        redirect_uri: args.redirectUri,
        code: args.code,
        code_verifier: args.codeVerifier,
      })}`,
      { signal: AbortSignal.timeout(10_000) },
    );
    if (!tokenRes.ok) throw new Error(`Facebook token endpoint answered ${tokenRes.status}`);
    const token = (await tokenRes.json()) as { access_token?: unknown };
    if (typeof token.access_token !== 'string' || !token.access_token) {
      throw new Error('Facebook response has no access_token');
    }

    // Bearer header, not a query param, so the token never lands in a URL log.
    const meRes = await fetch(`${GRAPH}/me?fields=id,name,email`, {
      headers: { authorization: `Bearer ${token.access_token}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!meRes.ok) throw new Error(`Facebook /me answered ${meRes.status}`);
    const me = (await meRes.json()) as { id?: unknown; name?: unknown; email?: unknown };
    if (typeof me.id !== 'string' || !me.id) throw new Error('Facebook /me has no id');

    return {
      subject: me.id,
      email: typeof me.email === 'string' && me.email ? me.email : null,
      name: typeof me.name === 'string' ? me.name : null,
    };
  }
}

/**
 * Checks a Meta `signed_request` (`<sig>.<payload>`, both base64url) against
 * the app secret and returns the Facebook user id. Never logs its input.
 * Anything wrong -> 400.
 */
export function verifySignedRequest(signedRequest: string, secret: string): string {
  const bad = () => new BadRequestException('Invalid signed_request');
  const parts = signedRequest.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) throw bad();
  const [sig, payload] = parts;

  const expected = createHmac('sha256', secret).update(payload).digest();
  const given = Buffer.from(sig, 'base64url');
  // timingSafeEqual throws on unequal lengths, so compare lengths first.
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw bad();

  let data: { algorithm?: unknown; user_id?: unknown };
  try {
    data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    throw bad();
  }
  if (data?.algorithm !== 'HMAC-SHA256') throw bad();
  if (typeof data.user_id !== 'string' || !data.user_id) throw bad();
  return data.user_id;
}
