import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as webpush from 'web-push';

/**
 * Reads the VAPID (Voluntary Application Server Identification) keys that
 * authorize this server to send Web Push notifications. All three of
 * VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT must be set for
 * push to work — see `scripts/generate-vapid-keys.mjs` to generate a
 * keypair, and `.env.example` for the placeholder entries.
 *
 * Deliberately degrades rather than throws: an unconfigured deployment
 * (e.g. local dev, or before an ADMIN has generated keys) just runs with
 * push disabled, logged once as a warning, instead of crashing boot.
 */
@Injectable()
export class PushConfigService implements OnModuleInit {
  private readonly logger = new Logger(PushConfigService.name);

  constructor(private readonly configService: ConfigService) {}

  onModuleInit(): void {
    if (!this.isPushEnabled()) {
      this.logger.warn(
        'Web push is disabled: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT must all be set to enable it.',
      );
      return;
    }
    webpush.setVapidDetails(
      this.getVapidSubject(),
      this.getVapidPublicKey(),
      this.getVapidPrivateKey(),
    );
  }

  getVapidPublicKey(): string {
    return this.configService.get<string>('VAPID_PUBLIC_KEY', '');
  }

  getVapidPrivateKey(): string {
    return this.configService.get<string>('VAPID_PRIVATE_KEY', '');
  }

  getVapidSubject(): string {
    return this.configService.get<string>('VAPID_SUBJECT', '');
  }

  isPushEnabled(): boolean {
    return Boolean(this.getVapidPublicKey() && this.getVapidPrivateKey() && this.getVapidSubject());
  }
}
