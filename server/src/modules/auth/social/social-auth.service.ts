import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'crypto';
import { Repository } from 'typeorm';
import { AuditAction, SocialProvider, UserStatus } from '@biddaloy/shared';
import { User } from '../../users/entities/user.entity';
import { AuditService } from '../../audit/audit.service';
import { resolveAppBaseUrl } from '../../account-access/app-base-url.util';
import { AuthService, AuthResult } from '../auth.service';
import type { RequestContext } from '../../../common/request-context.util';
import { SOCIAL_PROVIDERS, type SocialProviderClient } from './providers/social-provider';
import { SocialIdentityService } from './social-identity.service';
import { SocialIntent, SocialStateService } from './social-state.service';
import { SocialTicketService } from './social-ticket.service';

export interface CallbackOutcome {
  /** Absolute URL to send the browser to. */
  location: string;
  /** Set when the callback signed the user in; the controller sets the cookie. */
  session?: AuthResult;
  /** Registration ticket id; the controller puts it in a cookie, not the URL. */
  ticket?: string;
}

/**
 * Only same-origin paths may be carried through the flow (no open redirect).
 * Resolved with the URL parser so tab/newline/backslash tricks that browsers
 * normalise (`/\t/evil.com`) are judged as the browser would read them.
 */
export function safeRedirect(value: string | undefined, appBase: string): string | undefined {
  if (!value || !value.startsWith('/')) return undefined;
  try {
    const base = new URL(appBase);
    const url = new URL(value, base);
    if (url.origin !== base.origin) return undefined;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return undefined;
  }
}

@Injectable()
export class SocialAuthService {
  private readonly logger = new Logger(SocialAuthService.name);

  constructor(
    @Inject(SOCIAL_PROVIDERS) private readonly providers: SocialProviderClient[],
    private readonly state: SocialStateService,
    private readonly tickets: SocialTicketService,
    private readonly identities: SocialIdentityService,
    private readonly authService: AuthService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

  configuredProviders(): SocialProvider[] {
    return this.providers.filter((p) => p.isConfigured()).map((p) => p.name);
  }

  /** 404 for an unknown or unconfigured provider. */
  provider(name: string): SocialProviderClient {
    const found = this.providers.find((p) => p.name === name && p.isConfigured());
    if (!found) throw new NotFoundException('Unknown sign-in provider');
    return found;
  }

  private appUrl(path: string): string {
    return `${resolveAppBaseUrl(this.config)}${path}`;
  }

  private redirectUri(provider: SocialProviderClient): string {
    return this.appUrl(`/api/v1/auth/social/${provider.name}/callback`);
  }

  /** Returns the provider's authorization URL plus the state to bind to the browser. */
  async start(
    providerName: string,
    intent: SocialIntent,
    userId?: string,
    redirect?: string,
  ): Promise<{ url: string; state: string }> {
    const provider = this.provider(providerName);
    const { state, codeVerifier, nonce } = await this.state.create({
      provider: provider.name,
      intent,
      userId,
      redirect: safeRedirect(redirect, resolveAppBaseUrl(this.config)),
    });
    const url = provider.authorizeUrl({
      state,
      nonce,
      codeChallenge: createHash('sha256').update(codeVerifier).digest('base64url'),
      redirectUri: this.redirectUri(provider),
    });
    return { url, state };
  }

  async callback(
    providerName: string,
    query: { code?: string; state?: string; error?: string },
    boundState: string | undefined,
    context: RequestContext,
  ): Promise<CallbackOutcome> {
    const provider = this.provider(providerName);
    try {
      return await this.complete(provider, query, boundState, context);
    } catch (error) {
      // A full-page navigation: a Redis or DB fault must not show raw JSON.
      // Class name only, as for the exchange below.
      this.logger.warn(`${provider.name} callback failed: ${(error as Error).name}`);
      return { location: this.appUrl('/login?social=failed') };
    }
  }

  private async complete(
    provider: SocialProviderClient,
    query: { code?: string; state?: string; error?: string },
    boundState: string | undefined,
    context: RequestContext,
  ): Promise<CallbackOutcome> {
    // Consumed first so a replay (or a stolen URL) can never be used twice.
    const saved = query.state ? await this.state.consume(query.state) : null;
    // The state must also be the one this browser started (login-CSRF guard).
    if (!saved || saved.provider !== provider.name || boundState !== query.state) {
      // Full-page navigation: send the person back with a message, no session.
      return { location: this.appUrl('/login?social=failed') };
    }

    const back = this.backPath(saved.intent);
    if (query.error || !query.code) return { location: this.appUrl(`${back}?social=cancelled`) };

    let profile;
    try {
      profile = await provider.exchange({
        code: query.code,
        codeVerifier: saved.codeVerifier,
        nonce: saved.nonce,
        redirectUri: this.redirectUri(provider),
      });
    } catch (error) {
      // Class name only: the message could quote token text.
      this.logger.warn(`${provider.name} exchange failed: ${(error as Error).name}`);
      return { location: this.appUrl(`${back}?social=failed`) };
    }

    if (saved.intent === 'link') {
      // Re-checked here: the user may have been suspended since link-start.
      const linker = await this.users.findOne({ where: { id: saved.userId as string } });
      if (linker?.status !== UserStatus.ACTIVE) {
        return { location: this.appUrl('/security?social=failed') };
      }
      const ok = await this.identities.link(
        saved.userId as string,
        { provider: provider.name, ...profile },
        undefined,
        context,
      );
      return {
        location: this.appUrl(
          ok ? `/security?linked=${provider.name}` : '/security?social=conflict',
        ),
      };
    }

    const identity = await this.identities.findBySubject(provider.name, profile.subject);
    if (identity) {
      const user = await this.users.findOne({ where: { id: identity.user_id } });
      if (user && user.status === UserStatus.ACTIVE) {
        const session = await this.signIn(user, provider.name, identity.id, context);
        const redirect = saved.redirect ? `?redirect=${encodeURIComponent(saved.redirect)}` : '';
        return { location: this.appUrl(`/auth/social/done${redirect}`), session };
      }
      return { location: this.appUrl('/login?social=not_linked') };
    }

    if (saved.intent === 'register') {
      const ticket = await this.tickets.issue({ provider: provider.name, ...profile });
      return { location: this.appUrl(`/register?social=${provider.name}`), ticket };
    }
    // Never connect by matching email (D9): an unknown identity just isn't linked.
    return { location: this.appUrl('/login?social=not_linked') };
  }

  private backPath(intent: SocialIntent): string {
    return intent === 'link' ? '/security' : intent === 'register' ? '/register' : '/login';
  }

  private async signIn(
    user: User,
    provider: SocialProvider,
    identityId: string,
    context: RequestContext,
  ): Promise<AuthResult> {
    await this.users.update({ id: user.id }, { last_login_at: new Date() });
    await this.audit.record({
      action: AuditAction.LOGIN,
      entity_type: 'UserIdentity',
      entity_id: identityId,
      tenant_id: await this.authService.primaryTenantId(user.id),
      performed_by_user_id: user.id,
      ip_address: context.ip,
      user_agent: context.userAgent,
      new_values: { provider },
    });
    return this.authService.startSession(user, context);
  }
}
