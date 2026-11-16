import { Inject, Injectable, Logger } from '@nestjs/common';
import * as Sentry from '@sentry/node';
import type Redis from 'ioredis';
import {
  CommunicationMedium,
  DAILY_LIMITS_PLATFORM_KEY,
  DEFAULT_DAILY_SEND_LIMITS,
  type DailyLimitChannel,
} from '@biddaloy/shared';
import { OTP_REDIS } from '../../account-access/otp.service';
import { PlatformSettingsService } from '../../platform-identity/approvals/platform-settings.service';
import { SchoolsService } from '../../schools/schools.service';
import { TenantSettingsCache } from '../../schools/settings/tenant-settings-cache.service';
import { sanitiseDailyLimits } from '../../schools/settings/tenant-settings-resolver';

const TTL_SECONDS = 48 * 3600;
const PLATFORM_DEFAULT_TTL_MS = 30_000;
const CHANNELS: DailyLimitChannel[] = ['sms', 'email', 'whatsapp'];

// INCR; over the limit -> DECR (a refusal leaves no count behind) and, once a day, raise the
// flag the platform alert reads. Returns 1 = counted, 0 = refused. One script = atomic.
const COUNT_SCRIPT = `
local n = redis.call('INCR', KEYS[1])
redis.call('EXPIRE', KEYS[1], ARGV[2])
if n > tonumber(ARGV[1]) then
  redis.call('DECR', KEYS[1])
  redis.call('SET', KEYS[2], '1', 'EX', ARGV[2], 'NX')
  return 0
end
return 1
`;

type Limits = Record<DailyLimitChannel, number>;

/** Asia/Dhaka (UTC+6, no DST) calendar day, yyyymmdd (D20). */
function dhakaDay(now = Date.now()): string {
  return new Date(now + 6 * 3600_000).toISOString().slice(0, 10).replace(/-/g, '');
}

const chan = (m: CommunicationMedium) => m.toLowerCase() as DailyLimitChannel;

/**
 * [60.0 D7, D8, D20, D31] Per-school, per-channel daily send cap on the platform account.
 * ponytail: Redis only, lost on a Redis wipe (the day starts again at zero); move to a table
 * when a usage report needs history.
 */
@Injectable()
export class SendLimitService {
  private readonly logger = new Logger(SendLimitService.name);
  private platformCache: { at: number; value: Partial<Limits> } | null = null;

  constructor(
    @Inject(OTP_REDIS) private readonly redis: Redis,
    private readonly schools: SchoolsService,
    private readonly settingsCache: TenantSettingsCache,
    private readonly platform: PlatformSettingsService,
  ) {}

  /** The platform default changed: the next read is fresh. */
  invalidateDefaults(): void {
    this.platformCache = null;
  }

  private async platformDefaults(): Promise<Partial<Limits>> {
    const c = this.platformCache;
    if (c && Date.now() - c.at < PLATFORM_DEFAULT_TTL_MS) return c.value;
    const raw = await this.platform.get(DAILY_LIMITS_PLATFORM_KEY);
    const value = (sanitiseDailyLimits(raw) ?? {}) as Partial<Limits>;
    this.platformCache = { at: Date.now(), value };
    return value;
  }

  /** Per field: school ?? platform ?? default. A `{}` never means "no limit". */
  async effectiveLimits(tenantId: string): Promise<Limits> {
    const settings = await this.settingsCache.getOrLoad(tenantId, () =>
      this.schools.getDecryptedSettings(tenantId),
    );
    const school = (sanitiseDailyLimits(settings.communications?.dailyLimits) ??
      {}) as Partial<Limits>;
    const platform = await this.platformDefaults();
    const out = {} as Limits;
    for (const c of CHANNELS) out[c] = school[c] ?? platform[c] ?? DEFAULT_DAILY_SEND_LIMITS[c];
    return out;
  }

  private key(prefix: string, tenantId: string, medium: CommunicationMedium) {
    return `${prefix}:${tenantId}:${chan(medium)}:${dhakaDay()}`;
  }

  /** Redis down = fail open (D8, Rule 15): the REDIS_DOWN alert already tells the owners. */
  private failOpen(err: unknown): void {
    this.logger.warn(`Send limit check skipped: ${err instanceof Error ? err.name : typeof err}`);
    Sentry.captureException(err);
  }

  async tryCount(
    tenantId: string,
    medium: CommunicationMedium,
  ): Promise<'OK' | { remaining: 0; limit: number }> {
    try {
      const limit = (await this.effectiveLimits(tenantId))[chan(medium)];
      const counted = await this.redis.eval(
        COUNT_SCRIPT,
        2,
        this.key('send-limit', tenantId, medium),
        this.key('send-limit-hit', tenantId, medium),
        limit,
        TTL_SECONDS,
      );
      return counted === 1 ? 'OK' : { remaining: 0, limit };
    } catch (err) {
      this.failOpen(err);
      return 'OK';
    }
  }

  async remaining(
    tenantId: string,
    medium: CommunicationMedium,
  ): Promise<{ limit: number; remaining: number }> {
    try {
      const limit = (await this.effectiveLimits(tenantId))[chan(medium)];
      const used = Number((await this.redis.get(this.key('send-limit', tenantId, medium))) ?? 0);
      return { limit, remaining: Math.max(0, limit - used) };
    } catch (err) {
      this.failOpen(err);
      const limit = DEFAULT_DAILY_SEND_LIMITS[chan(medium)];
      return { limit, remaining: limit };
    }
  }

  /** Channels that were refused at least once today (the alert rule's input). */
  async hitToday(tenantId: string): Promise<CommunicationMedium[]> {
    const media = [
      CommunicationMedium.SMS,
      CommunicationMedium.EMAIL,
      CommunicationMedium.WHATSAPP,
    ];
    try {
      const flags = await Promise.all(
        media.map((m) => this.redis.exists(this.key('send-limit-hit', tenantId, m))),
      );
      return media.filter((_, i) => flags[i] === 1);
    } catch (err) {
      this.failOpen(err);
      return [];
    }
  }
}
