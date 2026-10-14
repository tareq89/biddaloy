import {
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
  SetMetadata,
} from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { ThrottlerStorageUnavailableError } from './fail-open-throttler-storage';

export const FAIL_CLOSED_WITHOUT_REDIS_KEY = 'failClosedWithoutRedis';

/**
 * Put on a route (or a whole controller) that checks a password, or sends or checks a
 * one-time code: sign-in, OTP, step-up, recovery, register, contact change. With no rate
 * limiter those routes are open to unlimited guessing, so while Redis is down they answer
 * 503 instead. Leave it off routes that only keep signed-in people signed in (refresh,
 * logout, logout-all, sessions) and off read-only routes.
 */
export const FailClosedWithoutRedis = () => SetMetadata(FAIL_CLOSED_WITHOUT_REDIS_KEY, true);

/**
 * The global rate-limit guard. Behaves exactly like ThrottlerGuard while Redis is up. While
 * it is down: routes marked `@FailClosedWithoutRedis()` answer 503, everything else is
 * served (fail open; the storage already logged the error).
 */
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    try {
      return await super.canActivate(context);
    } catch (error) {
      if (!(error instanceof ThrottlerStorageUnavailableError)) throw error;
      const failClosed = this.reflector.getAllAndOverride<boolean>(FAIL_CLOSED_WITHOUT_REDIS_KEY, [
        context.getHandler(),
        context.getClass(),
      ]);
      if (failClosed) {
        throw new ServiceUnavailableException(
          'This action is temporarily unavailable. Please try again in a few minutes.',
        );
      }
      return true;
    }
  }
}
