import { Inject, Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import type Redis from 'ioredis';
import { SOCIAL_REDIS } from './social-redis';

export type SocialIntent = 'login' | 'register' | 'link';

export interface SocialState {
  provider: string;
  intent: SocialIntent;
  userId?: string;
  redirect?: string;
  codeVerifier: string;
  nonce: string;
}

const TTL_SECONDS = 10 * 60;

/** Server-side OAuth `state`: random id -> context in Redis, read once. */
@Injectable()
export class SocialStateService {
  constructor(@Inject(SOCIAL_REDIS) private readonly redis: Redis) {}

  async create(data: Omit<SocialState, 'codeVerifier' | 'nonce'>): Promise<{
    state: string;
    codeVerifier: string;
    nonce: string;
  }> {
    const state = randomBytes(32).toString('base64url');
    const codeVerifier = randomBytes(32).toString('base64url');
    const nonce = randomBytes(16).toString('base64url');
    const record: SocialState = { ...data, codeVerifier, nonce };
    await this.redis.set(`social:state:${state}`, JSON.stringify(record), 'EX', TTL_SECONDS);
    return { state, codeVerifier, nonce };
  }

  /** Read-once: a replayed or unknown state yields null. */
  async consume(state: string): Promise<SocialState | null> {
    const raw = await this.redis.getdel(`social:state:${state}`);
    return raw ? (JSON.parse(raw) as SocialState) : null;
  }
}
