import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { AlertCadence } from '@biddaloy/shared';
import { TENANT_STATUS_REDIS } from '../../schools/tenant-status.service';
import {
  ATTENTION_STALE_AFTER_MS,
  ATTENTION_SWEEP_DONE,
  AttentionSweepDonePayload,
  attentionEvents,
  attentionKeys,
} from '../attention.constants';
import { PlatformAttentionHealthDto } from './dto/platform-attention-health.dto';
import { sentryCronCheckIn } from './sentry-cron';

/** Stale when missing, unparsable, or older than D12's 15 minutes. */
export function heartbeatStatus(raw: string | null, now: Date): 'ok' | 'stale' {
  if (!raw) return 'stale';
  try {
    const at = new Date((JSON.parse(raw) as { at: string }).at).getTime();
    return Number.isNaN(at) || now.getTime() - at > ATTENTION_STALE_AFTER_MS ? 'stale' : 'ok';
  } catch {
    return 'stale';
  }
}

const CADENCES = [AlertCadence.FAST, AlertCadence.HOURLY, AlertCadence.DAILY] as const;
const FAILING_PREFIX = 'attention:failing:';

@Injectable()
export class AttentionHealthService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AttentionHealthService.name);

  constructor(
    @Inject(TENANT_STATUS_REDIS) private readonly redis: Redis,
    private readonly config: ConfigService,
  ) {}

  // Fires a Sentry Cron check-in after each FAST sweep (monitor: 5-min schedule, 15-min margin, D12).
  private readonly onSweepDone = (e: AttentionSweepDonePayload): void => {
    if (e.cadence === AlertCadence.FAST) {
      void sentryCronCheckIn(this.config.get<string>('ATTENTION_SENTRY_CRON_URL'), 'ok');
    }
  };

  onModuleInit(): void {
    attentionEvents.on(ATTENTION_SWEEP_DONE, this.onSweepDone);
  }

  onModuleDestroy(): void {
    attentionEvents.off(ATTENTION_SWEEP_DONE, this.onSweepDone);
  }

  async getHealth(): Promise<PlatformAttentionHealthDto> {
    try {
      const raws = await this.redis.mget(CADENCES.map((c) => attentionKeys.heartbeat(c)));
      const lastSweep: PlatformAttentionHealthDto['lastSweep'] = {
        FAST: null,
        HOURLY: null,
        DAILY: null,
      };
      const durationsMs: PlatformAttentionHealthDto['durationsMs'] = {
        FAST: null,
        HOURLY: null,
        DAILY: null,
      };
      CADENCES.forEach((c, i) => {
        try {
          const hb = JSON.parse(raws[i] ?? 'null') as { at?: string; durationMs?: number } | null;
          lastSweep[c] = hb?.at ?? null;
          durationsMs[c] = hb?.durationMs ?? null;
        } catch {
          // unparsable heartbeat reads as "never"
        }
      });

      // COUNT is only a hint (a page can be empty or partial), so loop until the cursor returns to 0.
      const keys: string[] = [];
      let cursor = '0';
      do {
        const [next, page] = await this.redis.scan(
          cursor,
          'MATCH',
          `${FAILING_PREFIX}*`,
          'COUNT',
          100,
        );
        keys.push(...page);
        cursor = next;
      } while (cursor !== '0');
      const failingRules = (
        await Promise.all(
          keys.map(async (key) => {
            const h = await this.redis.hgetall(key);
            // Key expired between SCAN and HGETALL.
            if (Object.keys(h).length === 0) return null;
            return {
              key: key.slice(FAILING_PREFIX.length),
              lastError: h.lastError ?? '',
              count: Number(h.count ?? 0),
            };
          }),
        )
      )
        .filter((r): r is NonNullable<typeof r> => r !== null)
        .sort((a, b) => b.count - a.count);

      return { lastSweep, durationsMs, failingRules };
    } catch (e) {
      this.logger.warn(`attention health read failed: ${String(e)}`);
      throw new ServiceUnavailableException('Attention health unavailable');
    }
  }
}
