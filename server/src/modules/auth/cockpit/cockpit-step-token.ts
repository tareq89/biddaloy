import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  COCKPIT_MFA_TOKEN_AUDIENCE,
  JWT_ALGORITHM,
  JWT_ISSUER,
  verifyWithRotation,
} from '../jwt-secrets';

export type CockpitStep = 'mfa' | 'device' | 'enrol';

/** Lifetimes in seconds: mfa 5 min, device 10 min, enrol 15 min. */
const LIFETIME_SECONDS: Record<CockpitStep, number> = {
  mfa: 5 * 60,
  device: 10 * 60,
  enrol: 15 * 60,
};

/** One sentence for every refusal (Rule 23): never says which check failed. */
export const COCKPIT_STEP_REFUSED = 'Sign-in failed. Please start again.';

/**
 * [Epic 98] Short tokens that carry an owner between the sign-in steps. They hold `sub` and the
 * step name only, use their own audience, and never pass the cockpit access strategy.
 */
@Injectable()
export class CockpitStepTokens {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  sign(userId: string, step: CockpitStep): string {
    return this.jwt.sign(
      { sub: userId, step },
      { audience: COCKPIT_MFA_TOKEN_AUDIENCE, expiresIn: LIFETIME_SECONDS[step] },
    );
  }

  /** Returns the user id, or throws the one refusal sentence. */
  async verify(token: string | undefined, step: CockpitStep): Promise<string> {
    if (!token) throw new UnauthorizedException(COCKPIT_STEP_REFUSED);
    try {
      const payload = await verifyWithRotation<{ sub?: string; step?: string }>(
        this.jwt,
        token,
        this.config,
        { audience: COCKPIT_MFA_TOKEN_AUDIENCE, issuer: JWT_ISSUER, algorithms: [JWT_ALGORITHM] },
      );
      if (payload.step !== step || !payload.sub) throw new Error('step');
      return payload.sub;
    } catch {
      throw new UnauthorizedException(COCKPIT_STEP_REFUSED);
    }
  }
}
