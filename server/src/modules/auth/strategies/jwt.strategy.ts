import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { JwtPayload } from '@beton-boi/shared';

/**
 * Validates the JWT on every authenticated request.
 *
 * Extracts the token from the Authorization header (Bearer scheme),
 * verifies the signature using the configured JWT_SECRET, and attaches
 * the decoded payload to `req.user`.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET || 'fallback-secret',
    });
  }

  async validate(payload: JwtPayload): Promise<JwtPayload> {
    // Ensure the payload has the expected structure
    if (!payload.sub || !payload.memberships) {
      throw new UnauthorizedException('Invalid token payload');
    }
    return payload;
  }
}