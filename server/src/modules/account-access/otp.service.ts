import {
  Inject,
  Injectable,
  HttpException,
  HttpStatus,
  ServiceUnavailableException,
} from '@nestjs/common';
import type Redis from 'ioredis';
import { randomInt, createHash } from 'crypto';
import { toLatinDigits } from '../../common/utils/bengali-digits.util';

export const OTP_REDIS = 'OTP_REDIS';

export type OtpPurpose = 'PASSWORD_RESET' | 'LOGIN' | 'PHONE_VERIFY';
export type OtpVerifyResult = 'ok' | 'invalid' | 'expired' | 'locked';

const CODE_TTL_MS = 5 * 60_000;
const COOLDOWN_MS = 60_000;
const LOCK_TTL_MS = 15 * 60_000;
const MAX_ATTEMPTS = 5;

interface OtpRecord {
  hash: string;
  attempts: number;
}

function otpKey(purpose: OtpPurpose, identifier: string): string {
  return `otp:${purpose}:${identifier}`;
}
function cooldownKey(purpose: OtpPurpose, identifier: string): string {
  return `otp-cooldown:${purpose}:${identifier}`;
}
function lockKey(purpose: OtpPurpose, identifier: string): string {
  return `otp-lock:${purpose}:${identifier}`;
}
function hashCode(code: string): string {
  return createHash('sha256').update(code, 'utf8').digest('hex');
}

/**
 * Thrown when a request for a new OTP arrives inside the 60s cooldown of
 * the previous one for the same (purpose, identifier).
 */
export class TooManyRequestsException extends HttpException {
  constructor() {
    super('Please wait before requesting another code', HttpStatus.TOO_MANY_REQUESTS);
  }
}

/**
 * One `OtpService` shared by every OTP consumer (12.1's D3) — password
 * recovery (12.3) and OTP login (12.5) both call this rather than each
 * re-implementing Redis-backed code storage and attempt-lockout.
 *
 * Unlike `LoginAttemptService`, this does NOT fail open on a Redis error:
 * with no store there is nothing to verify a code against, so failing
 * open would accept any code as valid. A `ServiceUnavailableException` is
 * the honest answer instead.
 *
 * The plain code is never logged — every log call in this class only ever
 * mentions the purpose/identifier, never the code or its hash.
 */
@Injectable()
export class OtpService {
  constructor(@Inject(OTP_REDIS) private readonly redis: Redis) {}

  async request(purpose: OtpPurpose, identifier: string): Promise<{ code: string }> {
    try {
      const cooldown = await this.redis.get(cooldownKey(purpose, identifier));
      if (cooldown) {
        throw new TooManyRequestsException();
      }

      const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
      const record: OtpRecord = { hash: hashCode(code), attempts: 0 };
      await this.redis.set(otpKey(purpose, identifier), JSON.stringify(record), 'PX', CODE_TTL_MS);
      await this.redis.set(cooldownKey(purpose, identifier), '1', 'PX', COOLDOWN_MS);
      return { code };
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException('Verification is temporarily unavailable');
    }
  }

  async verify(purpose: OtpPurpose, identifier: string, rawCode: string): Promise<OtpVerifyResult> {
    const code = toLatinDigits(rawCode);
    try {
      const locked = await this.redis.get(lockKey(purpose, identifier));
      if (locked) return 'locked';

      const raw = await this.redis.get(otpKey(purpose, identifier));
      if (!raw) return 'expired';

      const record = JSON.parse(raw) as OtpRecord;
      if (record.hash === hashCode(code)) {
        await this.redis.del(otpKey(purpose, identifier));
        await this.redis.del(cooldownKey(purpose, identifier));
        return 'ok';
      }

      const attempts = record.attempts + 1;
      if (attempts >= MAX_ATTEMPTS) {
        await this.redis.set(lockKey(purpose, identifier), '1', 'PX', LOCK_TTL_MS);
        await this.redis.del(otpKey(purpose, identifier));
        return 'locked';
      }

      // Keep the remaining TTL rather than resetting it — a wrong guess
      // must not extend how long a code stays guessable.
      const remainingTtl = await this.redis.pttl(otpKey(purpose, identifier));
      const nextRecord: OtpRecord = { hash: record.hash, attempts };
      await this.redis.set(
        otpKey(purpose, identifier),
        JSON.stringify(nextRecord),
        'PX',
        remainingTtl > 0 ? remainingTtl : CODE_TTL_MS,
      );
      return 'invalid';
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException('Verification is temporarily unavailable');
    }
  }
}
