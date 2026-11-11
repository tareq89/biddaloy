import { createHash, randomBytes } from 'node:crypto';
import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type Redis from 'ioredis';
import { UserStatus } from '@biddaloy/shared';
import type { ImpersonationMeResponse, UserRole } from '@biddaloy/shared';
import { User } from '../../users/entities/user.entity';
import { ImpersonationSession } from '../entities/impersonation-session.entity';
import { IMPERSONATION_REDIS, codeKey, impKey } from '../sessions/impersonation-redis';

export const IMPERSONATION_CODE_TTL_SEC = 60;
const NIL_UUID = '00000000-0000-0000-0000-000000000000';
// Same sentence as @FailClosedWithoutRedis (Rule 15).
const REDIS_DOWN = 'This action is temporarily unavailable. Please try again in a few minutes.';

export interface RedeemedSession {
  sid: string;
  userId: string;
  adminId: string;
  schoolId: string;
  /** Seconds the session has left (at least 1). */
  remainingSeconds: number;
  expiresAt: Date;
}

const hashOf = (code: string) => createHash('sha256').update(code).digest('hex');

/**
 * [99.2.02] One-time Login as exchange codes. Only the SHA-256 of a code is stored. Every
 * redeem failure answers the same 401 after the same three lookups (Rule 18, 23).
 */
@Injectable()
export class ImpersonationCodeService {
  private readonly logger = new Logger(ImpersonationCodeService.name);

  constructor(
    @InjectRepository(ImpersonationSession)
    private readonly sessions: Repository<ImpersonationSession>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @Inject(IMPERSONATION_REDIS) private readonly redis: Redis,
  ) {}

  async issue(sid: string): Promise<string> {
    const code = randomBytes(32).toString('base64url');
    const res = await this.redisOp(() =>
      this.redis.set(codeKey(hashOf(code)), sid, 'EX', IMPERSONATION_CODE_TTL_SEC),
    );
    if (res !== 'OK') this.redisDown();
    return code;
  }

  async redeem(code: string): Promise<RedeemedSession> {
    const found = await this.redisOp(() => this.redis.getdel(codeKey(hashOf(code))));
    // Unknown code: run the same lookups against a nil id so the work does not differ.
    const sid = found ?? NIL_UUID;
    const live = await this.redisOp(() => this.redis.exists(impKey(sid)));
    const row = await this.sessions.findOne({ where: { id: sid } });
    // Always look up a user (nil id when no row) so every failure does the same work.
    const user = await this.users.findOne({ where: { id: row?.target_user_id ?? NIL_UUID } });
    const now = Date.now();
    if (
      !found ||
      live !== 1 ||
      !row ||
      row.status !== 'ACTIVE' ||
      !row.expires_at ||
      row.expires_at.getTime() <= now ||
      !user ||
      user.status !== UserStatus.ACTIVE
    ) {
      throw new UnauthorizedException('Invalid or expired code');
    }
    return {
      sid,
      userId: row.target_user_id,
      adminId: row.platform_admin_id,
      schoolId: row.tenant_id,
      remainingSeconds: Math.max(1, Math.ceil((row.expires_at.getTime() - now) / 1000)),
      expiresAt: row.expires_at,
    };
  }

  /** The banner's status for the caller's own session. Null when the row is gone. */
  async describe(sid: string): Promise<ImpersonationMeResponse | null> {
    const row = await this.sessions
      .createQueryBuilder('s')
      .innerJoin('s.platform_admin', 'pa')
      .innerJoin('pa.user', 'au')
      .innerJoin('s.target_user', 'tu')
      .addSelect(['au.full_name', 'tu.full_name'])
      .where('s.id = :sid', { sid })
      .getRawAndEntities();
    const s = row.entities[0];
    if (!s) return null;
    return {
      sessionId: s.id,
      adminName: row.raw[0].au_full_name,
      userName: row.raw[0].tu_full_name,
      role: s.role as UserRole,
      viewOnly: s.view_only,
      writeLocked: s.write_locked,
      expiresAt: (s.expires_at ?? new Date(0)).toISOString(),
    };
  }

  private redisDown(): never {
    throw new HttpException(
      { statusCode: 503, message: REDIS_DOWN, code: 'REDIS_UNAVAILABLE' },
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }

  private async redisOp<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      this.logger.error(
        `Impersonation code Redis failure: ${error instanceof Error ? error.name : 'unknown'}`,
      );
      return this.redisDown();
    }
  }
}
