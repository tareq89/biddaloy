import type { SocialProvider } from '@biddaloy/shared';

export interface SocialProfile {
  subject: string;
  /** Only set when the provider vouches the address is verified. */
  email: string | null;
  name: string | null;
}

/** One sign-in provider (Google here, Facebook in 13.7.1). */
export interface SocialProviderClient {
  readonly name: SocialProvider;
  /** True only when every credential the provider needs is set. */
  isConfigured(): boolean;
  authorizeUrl(args: {
    state: string;
    codeChallenge: string;
    nonce: string;
    redirectUri: string;
  }): string;
  /** Exchanges the code over a direct TLS call; never returns or stores the provider's tokens. */
  exchange(args: {
    code: string;
    codeVerifier: string;
    nonce: string;
    redirectUri: string;
  }): Promise<SocialProfile>;
}

export const SOCIAL_PROVIDERS = 'SOCIAL_PROVIDERS';
