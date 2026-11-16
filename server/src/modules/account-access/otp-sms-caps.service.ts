import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import * as Sentry from '@sentry/node';
import type Redis from 'ioredis';
import { PlatformAlertsService } from '../health/platform-alerts/platform-alerts.service';
import { OTP_REDIS } from './otp.service';

/** D9: one IP may ask codes for this many different numbers per hour. */
export const PER_IP_DISTINCT_PER_HOUR = 10;
/** D9: the whole platform's OTP SMS per hour. */
export const PLATFORM_OTP_SMS_PER_HOUR = 500;

const TTL_SECONDS = 2 * 60 * 60;
const USAGE_TTL_SECONDS = 40 * 24 * 60 * 60;

const hourKey = (d = new Date()) => d.toISOString().slice(0, 13).replace(/\D/g, '');
const dayKey = (d = new Date()) => d.toISOString().slice(0, 10).replace(/\D/g, '');
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/**
 * [#3992] Caps on OTP SMS cost (email is never capped). Callers run these inside detached
 * work, so a refusal never changes the HTTP answer (Rules 18, 23). OTP issue already throws
 * without Redis (`OtpService.request`), so these checks never run with Redis down: no new
 * fail-open path (Rule 15). Redis holds sha256 of the number, never the number (Rule 13).
 */
@Injectable()
export class OtpSmsCapsService {
  // Public and mutable only so specs can lower them.
  perIpLimit = PER_IP_DISTINCT_PER_HOUR;
  platformLimit = PLATFORM_OTP_SMS_PER_HOUR;

  constructor(
    @Inject(OTP_REDIS) private readonly redis: Redis,
    private readonly alerts: PlatformAlertsService,
  ) {}

  /** `ip` null (signed-in or unknown callers) is covered by the platform ceiling only. */
  async allowForIp(ip: string | null, destination: string): Promise<boolean> {
    if (!ip) return true;
    const key = `otp-ip:${ip}:${hourKey()}`;
    // Atomic: a number joins the set only while room is left, so refused numbers never
    // take a slot and numbers already admitted keep working.
    const ok = await this.redis.eval(
      `local d = ARGV[1]
if redis.call('SISMEMBER', KEYS[1], d) == 1 then return 1 end
if redis.call('SCARD', KEYS[1]) >= tonumber(ARGV[2]) then return 0 end
redis.call('SADD', KEYS[1], d)
redis.call('EXPIRE', KEYS[1], ARGV[3])
return 1`,
      1,
      key,
      sha256(destination),
      this.perIpLimit,
      TTL_SECONDS,
    );
    return Number(ok) === 1;
  }

  async allowPlatform(): Promise<boolean> {
    const hour = hourKey();
    const key = `otp-sms-platform:${hour}`;
    const res = await this.redis.multi().incr(key).expire(key, TTL_SECONDS).exec();
    const count = Number(res?.[0]?.[1] ?? 0);
    if (count <= this.platformLimit) return true;
    // First trip of the hour alerts once, whichever API instance sees it first.
    const first = await this.redis.set(
      `otp-sms-platform-alerted:${hour}`,
      '1',
      'EX',
      TTL_SECONDS,
      'NX',
    );
    if (first === 'OK') {
      Sentry.captureMessage('OTP SMS platform ceiling reached', 'error');
      await this.alerts.notifyOperators(
        `ALERT: OTP SMS ceiling reached (${this.platformLimit} in one hour). SMS codes are off until the next hour; email codes still work.`,
      );
    }
    return false;
  }

  // ponytail: a bare counter for the Epic 100 (#3727) SMS report; move to a table there.
  async countUsage(): Promise<void> {
    const key = `usage:otp-sms:${dayKey()}`;
    await this.redis.multi().incr(key).expire(key, USAGE_TTL_SECONDS).exec();
  }
}
