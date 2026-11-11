import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PassportStrategy } from '@nestjs/passport';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { UserStatus } from '@biddaloy/shared';
import { User } from '../../users/entities/user.entity';
import { PlatformAdmin } from '../../platform-identity/entities/platform-admin.entity';
import type { CockpitPrincipal } from '../../platform-identity/cockpit-principal';
import { AccessTokenDenylistService } from '../access-token-denylist.service';
import { CockpitSessionService } from '../cockpit/cockpit-session.service';
import {
  COCKPIT_ACCESS_TOKEN_AUDIENCE,
  JWT_ALGORITHM,
  JWT_ISSUER,
  jwtVerifySecrets,
} from '../jwt-secrets';

/** Every refusal here is this one sentence (Rule 23). */
const REFUSED = 'Invalid token';

interface CockpitPayload {
  sub?: string;
  jti?: string;
  fam?: string;
  typ?: string;
  iat?: number;
  iat_ms?: number;
}

/**
 * [Epic 98] Validates a cockpit (platform owner) access token: audience `biddaloy:cockpit` only,
 * so an app token never passes here and a cockpit token never passes `jwt`.
 */
@Injectable()
export class CockpitJwtStrategy extends PassportStrategy(Strategy, 'cockpit-jwt') {
  constructor(
    configService: ConfigService,
    jwtService: JwtService,
    private readonly denylist: AccessTokenDenylistService,
    private readonly sessions: CockpitSessionService,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(PlatformAdmin) private readonly adminRepo: Repository<PlatformAdmin>,
  ) {
    if (!configService.get<string>('JWT_SECRET')) throw new Error('JWT_SECRET is not configured');
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      algorithms: [JWT_ALGORITHM],
      issuer: JWT_ISSUER,
      audience: COCKPIT_ACCESS_TOKEN_AUDIENCE,
      // Same rotation rule as JwtStrategy: only a signature mismatch moves to the previous secret.
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

  async validate(payload: CockpitPayload): Promise<CockpitPrincipal> {
    if (!payload.sub || !payload.jti || !payload.fam || payload.typ !== 'cockpit') {
      throw new UnauthorizedException(REFUSED);
    }
    if (await this.denylist.isRevoked({ ...payload, jti: payload.jti, sub: payload.sub })) {
      throw new UnauthorizedException(REFUSED);
    }

    const user = await this.userRepo.findOne({
      where: { id: payload.sub },
      select: { id: true, status: true, tokens_valid_after: true, deleted_at: true },
      withDeleted: true,
    });
    // A SUSPENDED (locked) owner is refused here (D24).
    if (!user || user.deleted_at || user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException(REFUSED);
    }
    if (!(await this.adminRepo.count({ where: { user_id: user.id } }))) {
      throw new UnauthorizedException(REFUSED);
    }
    if (user.tokens_valid_after) {
      const cutMs = user.tokens_valid_after.getTime();
      const revoked =
        payload.iat_ms !== undefined
          ? payload.iat_ms < cutMs
          : (payload.iat ?? 0) < Math.floor(cutMs / 1000);
      if (revoked) throw new UnauthorizedException(REFUSED);
    }

    // Renews the idle key; throws 401 when idle or absolute time has passed.
    await this.sessions.touch(payload.fam);
    return { sub: payload.sub, jti: payload.jti, fam: payload.fam, typ: 'cockpit' };
  }
}
