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

// Claims the cooldown key with `SET NX` and, only if that succeeds, writes
// the OTP record in the same round trip — a plain `GET` cooldown check
// followed by a separate `SET` (the previous shape) left a window where two
// concurrent `request()` calls could both pass the check and both send an
// SMS/email for the same identifier. Returns 1 if this call won the race
// and issued a code, 0 if a cooldown was already live.
const REQUEST_SCRIPT = `
local claimed = redis.call('SET', KEYS[2], '1', 'PX', ARGV[3], 'NX')
if not claimed then
  return 0
end
redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2])
return 1
`;

// One Lua script for the whole read-check-increment-or-clear sequence — a
// separate GET/SET pair (the previous shape) let two concurrent guesses
// both read the same `attempts` count and both write it back incremented
// by exactly one, silently losing an attempt and letting a guesser outlast
// the 5-attempt lockout. Runs entirely inside Redis, so no other client can
// observe or mutate these keys mid-sequence.
const VERIFY_SCRIPT = `
if redis.call('GET', KEYS[3]) then
  return 'locked'
end
local raw = redis.call('GET', KEYS[1])
if not raw then
  return 'expired'
end
local record = cjson.decode(raw)
if record.hash == ARGV[1] then
  redis.call('DEL', KEYS[1])
  redis.call('DEL', KEYS[2])
  return 'ok'
end
local attempts = record.attempts + 1
if attempts >= tonumber(ARGV[2]) then
  redis.call('SET', KEYS[3], '1', 'PX', ARGV[3])
  redis.call('DEL', KEYS[1])
  return 'locked'
end
local ttl = redis.call('PTTL', KEYS[1])
if ttl <= 0 then
  ttl = tonumber(ARGV[4])
end
redis.call('SET', KEYS[1], cjson.encode({ hash = record.hash, attempts = attempts }), 'PX', ttl)
return 'invalid'
`;

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
      const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
      const record: OtpRecord = { hash: hashCode(code), attempts: 0 };

      const claimed = await this.redis.eval(
        REQUEST_SCRIPT,
        2,
        otpKey(purpose, identifier),
        cooldownKey(purpose, identifier),
        JSON.stringify(record),
        CODE_TTL_MS,
        COOLDOWN_MS,
      );
      if (claimed === 0) {
        throw new TooManyRequestsException();
      }
      return { code };
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException('Verification is temporarily unavailable');
    }
  }

  async verify(purpose: OtpPurpose, identifier: string, rawCode: string): Promise<OtpVerifyResult> {
    const code = toLatinDigits(rawCode);
    try {
      const result = await this.redis.eval(
        VERIFY_SCRIPT,
        3,
        otpKey(purpose, identifier),
        cooldownKey(purpose, identifier),
        lockKey(purpose, identifier),
        hashCode(code),
        MAX_ATTEMPTS,
        LOCK_TTL_MS,
        CODE_TTL_MS,
      );
      return result as OtpVerifyResult;
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException('Verification is temporarily unavailable');
    }
  }
}
