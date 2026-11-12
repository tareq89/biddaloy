import {
  Inject,
  Injectable,
  Optional,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PassportStrategy } from '@nestjs/passport';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type Redis from 'ioredis';
import { ExtractJwt, Strategy } from 'passport-jwt';
import {
  ImpersonatedJwtPayload,
  ImpersonationLiveSession,
  JwtPayload,
  UserStatus,
} from '@biddaloy/shared';
import { RequestActorContext } from '../../../common/request-actor-context';
import { IMPERSONATION_REDIS, impKey } from '../../support-access/sessions/impersonation-redis';
import { User } from '../../users/entities/user.entity';
import { PlatformAdmin } from '../../platform-identity/entities/platform-admin.entity';
import { AccessTokenDenylistService } from '../access-token-denylist.service';
import { ACCESS_TOKEN_AUDIENCE, JWT_ALGORITHM, JWT_ISSUER, jwtVerifySecrets } from '../jwt-secrets';

/**
 * Validates the JWT on every authenticated request.
 *
 * Extracts the token from the Authorization header (Bearer scheme),
 * verifies the signature using the configured JWT_SECRET, and attaches
 * the decoded payload to `req.user`.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    jwtService: JwtService,
    private readonly denylist: AccessTokenDenylistService,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(PlatformAdmin) private readonly adminRepo: Repository<PlatformAdmin>,
    // Optional until #3797 registers the provider; an `imp` token with no client fails closed (503).
    @Optional() @Inject(IMPERSONATION_REDIS) private readonly redis?: Redis,
  ) {
    const secret = configService.get<string>('JWT_SECRET');
    if (!secret) {
      // env.validation.ts already enforces this at boot; this guards any
      // path that constructs the strategy without full env validation
      // (tests, scripts, a future partial-module bootstrap).
      throw new Error('JWT_SECRET is not configured');
    }

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      algorithms: [JWT_ALGORITHM],
      issuer: JWT_ISSUER,
      audience: ACCESS_TOKEN_AUDIENCE,
      // Rotation (D21): current secret first, JWT_SECRET_PREVIOUS only when the
      // token's signature does not match it. Verify-only; signing never uses previous.
      // Passport does the full verify afterwards, so this only picks the key: no
      // second verify without a previous secret, and expiry is left to passport
      // (an expired current-secret token then reports "jwt expired", not a bad signature).
      // Only a signature mismatch moves to previous; any other failure (wrong alg, iss, aud)
      // keeps current, so passport reports the real reason.
      secretOrKeyProvider: (_req, rawJwt, done) => {
        const [current, previous] = jwtVerifySecrets(configService);
        if (!previous) return done(null, current);
        try {
          jwtService.verify(rawJwt, { secret: current, ignoreExpiration: true });
          done(null, current);
        } catch (error) {
          done(null, (error as Error).message === 'invalid signature' ? previous : current);
        }
      },
    });
  }

  async validate(payload: JwtPayload): Promise<JwtPayload | ImpersonatedJwtPayload> {
    // Ensure the payload has the expected structure
    if (!payload.sub || !payload.memberships || !payload.jti) {
      throw new UnauthorizedException('Invalid token payload');
    }

    // Single-purpose tokens (e.g. a password-reset challenge) must never be
    // accepted as a general access token, even if they otherwise satisfy the
    // shape checks above.
    if ('purpose' in payload) {
      throw new UnauthorizedException('Invalid token payload');
    }

    // Lets logout-all and reuse-detected revocation take effect
    // immediately instead of waiting out the token's own short lifetime —
    // see access-token-denylist.service.ts.
    if (await this.denylist.isRevoked(payload)) {
      throw new UnauthorizedException('Token has been revoked');
    }

    // [75.2, D12] One PK read: the account must still be live and ACTIVE, and
    // the token must be newer than the user's cut-off (removal, password reset).
    const user = await this.userRepo.findOne({
      where: { id: payload.sub },
      select: { id: true, status: true, tokens_valid_after: true, deleted_at: true },
      withDeleted: true,
    });
    if (!user || user.deleted_at || user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('Token has been revoked');
    }
    this.assertNotCutOff(payload, user.tokens_valid_after);

    // [98.2.04] Defence in depth: a token minted before the user became an owner dies here.
    if (await this.adminRepo.exists({ where: { user_id: payload.sub } })) {
      throw new UnauthorizedException('Token has been revoked');
    }

    if (payload.imp === undefined) {
      // A plain token never carries a live session: drop a stray `impSession` claim.
      if ('impSession' in payload) {
        const { impSession: _stray, ...rest } = payload as JwtPayload & { impSession?: unknown };
        return rest as JwtPayload;
      }
      return payload;
    }
    return this.validateImpersonation(payload);
  }

  // ponytail: a token without iat_ms (legacy) has only whole-second iat, so one minted in
  // the same second as the cut-off survives; `<`, not `<=`, so a refresh racing the cut-off
  // is never rejected in a loop. Drop the fallback once legacy tokens have expired.
  private assertNotCutOff(payload: JwtPayload, cut: Date | null | undefined): void {
    if (!cut) return;
    const cutMs = cut.getTime();
    const revoked =
      payload.iat_ms !== undefined
        ? payload.iat_ms < cutMs
        : (payload.iat ?? 0) < Math.floor(cutMs / 1000);
    if (revoked) throw new UnauthorizedException('Token has been revoked');
  }

  /** [99.2.03] An `imp` token lives only while its Redis session, owner and cut-off all hold. Fails closed. */
  private async validateImpersonation(payload: JwtPayload): Promise<ImpersonatedJwtPayload> {
    const imp: unknown = payload.imp;
    const { sid, pa } = (imp && typeof imp === 'object' ? imp : {}) as Record<string, unknown>;
    if (
      typeof sid !== 'string' ||
      typeof pa !== 'string' ||
      !UUID_RE.test(sid) ||
      !UUID_RE.test(pa) ||
      // imp tokens are always new: no legacy whole-second `iat` fallback for the owner cut-off.
      typeof payload.iat_ms !== 'number'
    ) {
      throw new UnauthorizedException('Invalid token payload');
    }
    try {
      RequestActorContext.setImpersonation({ sid, pa });
    } catch {
      throw new UnauthorizedException('Invalid token payload');
    }

    const unavailable = () =>
      new ServiceUnavailableException(
        'This action is temporarily unavailable. Please try again in a few minutes.',
      );
    if (!this.redis) throw unavailable();
    let raw: unknown;
    try {
      raw = await this.redis.get(impKey(sid));
    } catch {
      // Redis error text is never returned or logged.
      throw unavailable();
    }
    if (raw === null || raw === undefined) {
      throw new UnauthorizedException('Token has been revoked');
    }
    if (typeof raw !== 'string') throw unavailable();
    let live: ImpersonationLiveSession;
    try {
      live = JSON.parse(raw) as ImpersonationLiveSession;
    } catch {
      throw unavailable();
    }
    if (!live || typeof live !== 'object') throw unavailable();
    if (live.userId !== payload.sub || live.adminId !== pa) {
      throw new UnauthorizedException('Token has been revoked');
    }

    // The owner must still be live: a locked (SUSPENDED) or cut-off owner kills open sessions.
    // No owner refusal here: an owner is expected as `imp.pa`.
    const owner = await this.userRepo.findOne({
      where: { id: pa },
      select: { id: true, status: true, tokens_valid_after: true, deleted_at: true },
      withDeleted: true,
    });
    if (!owner || owner.deleted_at || owner.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('Token has been revoked');
    }
    this.assertNotCutOff(payload, owner.tokens_valid_after);

    return { ...payload, impSession: live };
  }
}
