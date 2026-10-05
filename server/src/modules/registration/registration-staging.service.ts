import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type Redis from 'ioredis';

export const REGISTRATION_REDIS = 'REGISTRATION_REDIS';
const TTL_SEC = 30 * 60;

export interface StagedRegistration {
  admin_name: string;
  school_name: string;
  country_code: string;
  address: string;
  phone: string;
  email: string;
  terms_accepted_at: string;
  /** What the code was sent to, and how. Fixed at start so verify cannot be pointed elsewhere. */
  identifier: string;
  channel: 'sms' | 'email';
  /** Extra codes already sent for this stage. */
  resends?: number;
}

/**
 * Holds the registration details for 30 minutes under `registration:<uuid>` until the code is
 * proven. Like ImportStagingService, a Redis error propagates — failing open would lose or
 * double-spend a registration.
 */
@Injectable()
export class RegistrationStagingService {
  private readonly logger = new Logger(RegistrationStagingService.name);

  constructor(@Inject(REGISTRATION_REDIS) private readonly redis: Redis) {}

  private key(id: string) {
    return `registration:${id}`;
  }

  async stage(payload: StagedRegistration): Promise<string> {
    const id = randomUUID();
    await this.redis.set(this.key(id), JSON.stringify(payload), 'EX', TTL_SEC);
    return id;
  }

  /** Rewrites a stage without touching its remaining lifetime. */
  async save(id: string, payload: StagedRegistration): Promise<void> {
    await this.redis.set(this.key(id), JSON.stringify(payload), 'KEEPTTL');
  }

  async peek(id: string): Promise<StagedRegistration | null> {
    return this.parse(await this.redis.get(this.key(id)));
  }

  /** Atomic read-and-delete: of two concurrent verifies, exactly one gets the payload. */
  async consume(id: string): Promise<StagedRegistration | null> {
    return this.parse(await this.redis.getdel(this.key(id)));
  }

  private parse(raw: string | null): StagedRegistration | null {
    if (!raw) return null;
    try {
      return JSON.parse(raw) as StagedRegistration;
    } catch {
      this.logger.error('Malformed staged registration');
      return null;
    }
  }
}
