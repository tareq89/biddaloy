import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

const unavailable = () =>
  new ServiceUnavailableException({
    message: 'Registration is temporarily unavailable',
    details: { code: 'REGISTRATION_UNAVAILABLE' },
  });

/** Cloudflare Turnstile check for the public registration routes. */
@Injectable()
export class TurnstileService {
  constructor(private readonly config: ConfigService) {}

  private get secret(): string | undefined {
    return this.config.get<string>('TURNSTILE_SECRET_KEY') || undefined;
  }

  /** In production with no secret configured, every register route is closed (never fail open). */
  assertAvailable(): void {
    if (!this.secret && this.config.get<string>('NODE_ENV') === 'production') throw unavailable();
  }

  async verify(token: string, ip: string | null): Promise<void> {
    this.assertAvailable();
    const secret = this.secret;
    if (!secret) return; // dev/test only; assertAvailable closed production above

    let success = false;
    try {
      const body = new URLSearchParams({ secret, response: token });
      if (ip) body.set('remoteip', ip);
      const res = await fetch(SITEVERIFY_URL, {
        method: 'POST',
        body,
        signal: AbortSignal.timeout(5000),
      });
      success = ((await res.json()) as { success?: boolean }).success === true;
    } catch {
      throw unavailable();
    }
    if (!success) throw new BadRequestException('Captcha verification failed');
  }
}
