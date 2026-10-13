import { ExecutionContext, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';
import { ThrottlerStorageUnavailableError } from './fail-open-throttler-storage';

// Under /auth/ but keep signed-in people signed in: refresh tokens are DB rows, not guessable
// secrets, so these need no rate limit to be safe.
const KEEP_WORKING_WITHOUT_REDIS = [
  'POST /auth/refresh',
  'POST /auth/logout',
  'POST /auth/logout-all',
  'GET /auth/sessions',
  'DELETE /auth/sessions/:id',
];

/**
 * True for the sign-in, code, reset, register and step-up routes: with no rate limiter they
 * would be open to unlimited guessing, so they must answer 503 while Redis is down.
 */
export function requiresRedis(method: string, path: string): boolean {
  const rest = path.replace(/^\/api\/v\d+/, '');
  if (!rest.startsWith('/auth/')) return false;
  return !KEEP_WORKING_WITHOUT_REDIS.includes(`${method.toUpperCase()} ${rest}`);
}

/**
 * The global rate-limit guard. Behaves exactly like ThrottlerGuard while Redis is up. While
 * it is down: `/auth/*` sign-in routes answer 503, everything else is served (fail open; the
 * storage already logged the error).
 */
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    try {
      return await super.canActivate(context);
    } catch (error) {
      if (!(error instanceof ThrottlerStorageUnavailableError)) throw error;
      const req = context.switchToHttp().getRequest<Request>();
      if (requiresRedis(req.method, req.route?.path ?? req.path)) {
        throw new ServiceUnavailableException(
          'Sign-in is temporarily unavailable. Please try again in a few minutes.',
        );
      }
      return true;
    }
  }
}
