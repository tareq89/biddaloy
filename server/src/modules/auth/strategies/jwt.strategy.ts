import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PassportStrategy } from '@nestjs/passport';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { JwtPayload, UserStatus } from '@biddaloy/shared';
import { User } from '../../users/entities/user.entity';
import { AccessTokenDenylistService } from '../access-token-denylist.service';
import { ACCESS_TOKEN_AUDIENCE, JWT_ALGORITHM, JWT_ISSUER, jwtVerifySecrets } from '../jwt-secrets';

/**
 * Validates the JWT on every authenticated request.
 *
 * Extracts the token from the Authorization header (Bearer scheme),
 * verifies the signature using the configured JWT_SECRET, and attaches
 * the decoded payload to `req.user`.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    jwtService: JwtService,
    private readonly denylist: AccessTokenDenylistService,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
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

  async validate(payload: JwtPayload): Promise<JwtPayload> {
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
    if (user.tokens_valid_after) {
      const cutMs = user.tokens_valid_after.getTime();
      // ponytail: a token without iat_ms (legacy) has only whole-second iat, so one minted in
      // the same second as the cut-off survives; `<`, not `<=`, so a refresh racing the cut-off
      // is never rejected in a loop. Drop the fallback once legacy tokens have expired.
      const revoked =
        payload.iat_ms !== undefined
          ? payload.iat_ms < cutMs
          : (payload.iat ?? 0) < Math.floor(cutMs / 1000);
      if (revoked) throw new UnauthorizedException('Token has been revoked');
    }

    return payload;
  }
}
