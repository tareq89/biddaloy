import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../users/entities/user.entity';
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

export interface CockpitStepClaim {
  userId: string;
  /** App-clock ms when the password was proven; carried unchanged from step to step. */
  authAt: number;
}

/**
 * [Epic 98] Short tokens that carry an owner between the sign-in steps. They hold `sub`, the step
 * name and `at` (when the password was proven), use their own audience, and never pass the
 * cockpit access strategy. A token older than the user's `tokens_valid_after` (password reset,
 * lock, sign out everywhere) is refused, so a challenge never outlives the password it proved.
 */
@Injectable()
export class CockpitStepTokens {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

  /** `authAt` is now for the first step; a later step passes the claim it was given. */
  sign(userId: string, step: CockpitStep, authAt: number = Date.now()): string {
    return this.jwt.sign(
      { sub: userId, step, at: authAt },
      { audience: COCKPIT_MFA_TOKEN_AUDIENCE, expiresIn: LIFETIME_SECONDS[step] },
    );
  }

  /** Returns the claim, or throws the one refusal sentence. */
  async verify(token: string | undefined, step: CockpitStep): Promise<CockpitStepClaim> {
    if (!token) throw new UnauthorizedException(COCKPIT_STEP_REFUSED);
    try {
      const payload = await verifyWithRotation<{ sub?: string; step?: string; at?: number }>(
        this.jwt,
        token,
        this.config,
        { audience: COCKPIT_MFA_TOKEN_AUDIENCE, issuer: JWT_ISSUER, algorithms: [JWT_ALGORITHM] },
      );
      if (payload.step !== step || !payload.sub || typeof payload.at !== 'number') {
        throw new Error('step');
      }
      const user = await this.users.findOne({
        where: { id: payload.sub },
        select: { id: true, tokens_valid_after: true },
      });
      if (!user) throw new Error('user');
      // Same rule as the access strategies: `<`, app clock on both sides (session-cutoff.service.ts).
      if (user.tokens_valid_after && payload.at < user.tokens_valid_after.getTime()) {
        throw new Error('cut-off');
      }
      return { userId: payload.sub, authAt: payload.at };
    } catch {
      throw new UnauthorizedException(COCKPIT_STEP_REFUSED);
    }
  }
}
