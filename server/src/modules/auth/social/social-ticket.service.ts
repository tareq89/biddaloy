import { Inject, Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import type Redis from 'ioredis';
import { SOCIAL_REDIS } from './social-redis';

export interface SocialTicket {
  provider: string;
  subject: string;
  email: string | null;
  name: string | null;
}

const TTL_SECONDS = 15 * 60;

/** Proof that a social account was authenticated, carried into registration. */
@Injectable()
export class SocialTicketService {
  constructor(@Inject(SOCIAL_REDIS) private readonly redis: Redis) {}

  async issue(ticket: SocialTicket): Promise<string> {
    const id = randomBytes(32).toString('base64url');
    await this.redis.set(`social:ticket:${id}`, JSON.stringify(ticket), 'EX', TTL_SECONDS);
    return id;
  }

  /** Read-once; null when unknown, expired or already used. */
  async consume(id: string): Promise<SocialTicket | null> {
    const raw = await this.redis.getdel(`social:ticket:${id}`);
    return raw ? (JSON.parse(raw) as SocialTicket) : null;
  }
}
