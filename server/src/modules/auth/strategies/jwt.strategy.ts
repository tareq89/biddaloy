import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { JwtPayload } from '@biddaloy/shared';
import { AccessTokenDenylistService } from '../access-token-denylist.service';

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
    private readonly denylist: AccessTokenDenylistService,
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
      secretOrKey: secret,
    });
  }

  async validate(payload: JwtPayload): Promise<JwtPayload> {
    // Ensure the payload has the expected structure
    if (!payload.sub || !payload.memberships || !payload.jti) {
      throw new UnauthorizedException('Invalid token payload');
    }

    // Lets logout-all and reuse-detected revocation take effect
    // immediately instead of waiting out the token's own short lifetime —
    // see access-token-denylist.service.ts.
    if (await this.denylist.isRevoked(payload.jti)) {
      throw new UnauthorizedException('Token has been revoked');
    }

    return payload;
  }
}
