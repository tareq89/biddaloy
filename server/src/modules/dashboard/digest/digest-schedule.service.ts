import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectDataSource } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { DataSource } from 'typeorm';
import Redis from 'ioredis';
import { UserRole } from '@biddaloy/shared';
import { SchoolsService } from '../../schools/schools.service';
import { TENANT_STATUS_REDIS } from '../../schools/tenant-status.service';
import { SchoolCalendarService } from '../../calendar/school-calendar.service';
import { PushService } from '../../push/push.service';
import { PushConfigService } from '../../push/push-config';
import { AttentionQueryService } from '../../attention/api/attention-query.service';
import { isInQuietHours, quietHoursEnd } from '../../attention/delivery/alert-delivery.service';
import { resolveLocale } from '../../attention/rules/messages';
import { localTimeHHmm } from '../../attention/rules/rule-context.service';
import { digestEnabled } from '../../users/dto/digest-preference.dto';
import { localDate } from '../../../common/time';
import { renderDigest } from './digest-templates';
import {
  DASHBOARD_DIGEST_QUEUE,
  DIGEST_RUN_JOB,
  DIGEST_SENT_TTL_SECONDS,
  DigestJobData,
  digestSchedulerIdFor,
  digestSentKey,
} from './digest.constants';

/** Order decides which role's summary a person with two digest roles in one school gets. */
const DIGEST_ROLES = [UserRole.ADMIN, UserRole.EXECUTIVE, UserRole.TEACHER];

interface Recipient {
  id: string;
  role: UserRole;
  preferences: Record<string, any> | null;
}

/**
 * Morning digest (8.10.7.5.12): one scheduler per ACTIVE school at `dashboard.digestTime` in the
 * school timezone, re-derived by the hourly reconciler (same shape as the backup schedule).
 * Content comes from the attention engine's summary; push goes through PushService.
 */
@Injectable()
export class DigestScheduleService {
  private readonly logger = new Logger(DigestScheduleService.name);

  constructor(
    @InjectQueue(DASHBOARD_DIGEST_QUEUE) private readonly queue: Queue<DigestJobData>,
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(TENANT_STATUS_REDIS) private readonly redis: Redis,
    private readonly schools: SchoolsService,
    private readonly calendar: SchoolCalendarService,
    private readonly push: PushService,
    private readonly attention: AttentionQueryService,
    private readonly pushConfig: PushConfigService,
  ) {}

  async sync(tenantId: string): Promise<void> {
    const school = await this.schools.findById(tenantId);
    const id = digestSchedulerIdFor(tenantId);
    if (school.status !== 'ACTIVE') {
      await this.queue.removeJobScheduler(id);
      return;
    }
    const settings = await this.schools.getResolvedSettings(tenantId);
    const [hh, mm] = settings.dashboard!.digestTime.split(':');
    await this.queue.upsertJobScheduler(
      id,
      {
        pattern: `${mm} ${hh} * * *`,
        tz: settings.region?.timezone ?? 'Asia/Dhaka',
      },
      {
        name: DIGEST_RUN_JOB,
        data: { tenantId },
        opts: { removeOnComplete: true, removeOnFail: 100 },
      },
    );
  }

  /** Every school is visited so a suspended one loses its scheduler. One failure never aborts. */
  async syncAll(): Promise<void> {
    for (const school of await this.schools.findAll()) {
      try {
        await this.sync(school.id);
      } catch (err) {
        this.logger.error(`digest sync failed for tenant ${school.id}: ${String(err)}`);
      }
    }
  }

  async runNow(tenantId: string, deferred = false, now = new Date()): Promise<void> {
    if (!this.pushConfig.isPushEnabled()) {
      this.logger.log(`digest skipped for ${tenantId}: push is disabled`);
      return;
    }
    let school;
    try {
      school = await this.schools.findById(tenantId);
    } catch (err) {
      if (!(err instanceof NotFoundException)) throw err;
      // School was hard-deleted: its scheduler would fail every morning, so drop it.
      await this.queue.removeJobScheduler(digestSchedulerIdFor(tenantId));
      return;
    }
    if (school.status !== 'ACTIVE') {
      await this.sync(tenantId);
      return;
    }
    const settings = await this.schools.getResolvedSettings(tenantId);
    const tz = settings.region!.timezone;
    const today = localDate(now, tz);

    if (await this.calendar.isNonWorkingDay({ tenantId, date: today })) {
      this.logger.log(`digest skipped for ${tenantId}: non-working day`);
      return;
    }

    // Same quiet hours as the engine's individual pushes (D23): hold until they end.
    const quiet = settings.attention!.quietHours!;
    if (!deferred && isInQuietHours(localTimeHHmm(now, tz), quiet)) {
      await this.queue.add(
        DIGEST_RUN_JOB,
        { tenantId, deferred: true },
        {
          jobId: `dashboard-digest-deferred-${tenantId}-${today}`,
          delay: quietHoursEnd(now, tz, quiet).getTime() - now.getTime(),
          attempts: 1,
          removeOnComplete: true,
          removeOnFail: true,
        },
      );
      return;
    }

    // Fetched BEFORE the claim so a DB blip leaves the day unclaimed. Idempotent per school per
    // day: only the first run of the day sends. At-most-once: a crash mid-loop after the claim
    // is not retried (a duplicate push is worse than a missed digest).
    const recipients = await this.recipients(tenantId);
    const claimed = await this.redis.set(
      digestSentKey(tenantId, today),
      '1',
      'EX',
      DIGEST_SENT_TTL_SECONDS,
      'NX',
    );
    if (!claimed) return;

    const locale = resolveLocale(settings.region!.locale);
    let sent = 0;
    let optedOut = 0;
    let empty = 0;
    // ponytail: sequential per tenant; batch with a small concurrency pool if a school has > 500 recipients.
    for (const r of recipients) {
      if (!digestEnabled(r.preferences)) {
        optedOut++;
        continue;
      }
      try {
        const summary = await this.attention.summary(tenantId, r.id, r.role, { locale });
        const text = renderDigest(summary, locale, school.name);
        if (!text) {
          empty++;
          continue;
        }
        const res = await this.push.sendToUser(r.id, tenantId, {
          type: 'dashboard-digest',
          title: text.title,
          body: text.body,
          url: '/dashboard',
        });
        if (res.accepted > 0) sent++;
      } catch (err) {
        this.logger.warn(`digest failed for user ${r.id} in ${tenantId}: ${String(err)}`);
      }
    }
    this.logger.log(
      `digest ${tenantId}: recipients=${recipients.length} sent=${sent} optedOut=${optedOut} empty=${empty}`,
    );
  }

  /** One row per person: their first digest role in this school. */
  private async recipients(tenantId: string): Promise<Recipient[]> {
    const rows: Recipient[] = await this.dataSource.query(
      `SELECT u.id, ut.role, u.preferences
         FROM user_tenants ut JOIN users u ON u.id = ut.user_id
        WHERE ut.tenant_id = $1 AND ut.role::text = ANY($2::text[])
          AND ut.deleted_at IS NULL AND u.deleted_at IS NULL AND u.status = 'ACTIVE'`,
      [tenantId, DIGEST_ROLES],
    );
    const best = new Map<string, Recipient>();
    for (const r of rows) {
      const cur = best.get(r.id);
      if (!cur || DIGEST_ROLES.indexOf(r.role) < DIGEST_ROLES.indexOf(cur.role)) best.set(r.id, r);
    }
    return [...best.values()];
  }
}
