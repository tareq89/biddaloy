import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SocialProvider } from '@biddaloy/shared';
import type { SocialProfile, SocialProviderClient } from './social-provider';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

/**
 * Authorization-code flow with PKCE. The `id_token` is read from the direct
 * TLS response of the token endpoint (never from the browser), so its
 * signature need not be re-verified (OIDC Core 3.1.3.7); `iss`, `aud`, `exp`
 * and `nonce` are still checked.
 */
@Injectable()
export class GoogleProvider implements SocialProviderClient {
  readonly name = SocialProvider.GOOGLE;

  constructor(private readonly config: ConfigService) {}

  private get clientId(): string | undefined {
    return this.config.get<string>('GOOGLE_OAUTH_CLIENT_ID') || undefined;
  }

  private get clientSecret(): string | undefined {
    return this.config.get<string>('GOOGLE_OAUTH_CLIENT_SECRET') || undefined;
  }

  isConfigured(): boolean {
    return !!this.clientId && !!this.clientSecret;
  }

  authorizeUrl(args: {
    state: string;
    codeChallenge: string;
    nonce: string;
    redirectUri: string;
  }): string {
    const url = new URL(AUTH_URL);
    url.search = new URLSearchParams({
      client_id: this.clientId ?? '',
      redirect_uri: args.redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state: args.state,
      nonce: args.nonce,
      code_challenge: args.codeChallenge,
      code_challenge_method: 'S256',
    }).toString();
    return url.toString();
  }

  async exchange(args: {
    code: string;
    codeVerifier: string;
    nonce: string;
    redirectUri: string;
  }): Promise<SocialProfile> {
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: args.code,
        code_verifier: args.codeVerifier,
        redirect_uri: args.redirectUri,
        client_id: this.clientId ?? '',
        client_secret: this.clientSecret ?? '',
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`Google token endpoint answered ${res.status}`);

    const body = (await res.json()) as { id_token?: unknown };
    if (typeof body.id_token !== 'string') throw new Error('Google response has no id_token');

    const claims = decodeJwtPayload(body.id_token);
    if (!ISSUERS.includes(claims.iss as string)) throw new Error('id_token: wrong issuer');
    if (claims.aud !== this.clientId) throw new Error('id_token: wrong audience');
    if (typeof claims.exp !== 'number' || claims.exp * 1000 <= Date.now()) {
      throw new Error('id_token: expired');
    }
    if (claims.nonce !== args.nonce) throw new Error('id_token: wrong nonce');
    if (typeof claims.sub !== 'string' || !claims.sub) throw new Error('id_token: no subject');

    return {
      subject: claims.sub,
      email:
        typeof claims.email === 'string' && claims.email_verified === true ? claims.email : null,
      name: typeof claims.name === 'string' ? claims.name : null,
    };
  }
}

function decodeJwtPayload(jwt: string): Record<string, unknown> {
  const part = jwt.split('.')[1];
  if (!part) throw new Error('id_token: malformed');
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
}
