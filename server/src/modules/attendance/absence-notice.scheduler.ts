import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { IsNull, Repository } from 'typeorm';
import { AttendanceSessionState, UserRole } from '@biddaloy/shared';
import { AttendanceSession } from './entities/attendance-session.entity';
import { UserTenant } from '../auth/entities/user-tenant.entity';
import { SchoolsService } from '../schools/schools.service';
import { SchoolCalendarService } from '../academics/school-calendar.service';
import { localToday, resolveAttendancePolicy } from './attendance-policy.util';
import { AbsenceNoticeService } from './absence-notice.service';

export const ABSENCE_NOTICE_SWEEP_QUEUE = 'absence-notice-sweep';
export const ABSENCE_NOTICE_SWEEP_JOB_ID = 'absence-notice-sweep';
export const ABSENCE_NOTICE_SWEEP_INTERVAL_MS = 15 * 60 * 1000; // every 15 minutes

/** `HH:mm` for `timezone`, right now — comparable lexicographically against
 * `AttendancePolicySettings.autoAbsentNotification.cutoffTime`, which is
 * stored in the same zero-padded 24-hour shape. */
function localTimeHHmm(timezone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date());
}

/**
 * Registers the repeatable cut-off sweep on boot, cloning
 * `RefreshTokenCleanupScheduler`'s `OnModuleInit` + `upsertJobScheduler`
 * shape exactly. [9.8]
 *
 * `upsertJobScheduler` dedupes by schedulerId, so re-registering on every
 * restart is idempotent rather than piling up duplicate schedules.
 *
 * This class doubles as the queue's own worker (`@Processor`) rather than
 * living in a separate processor file — the sweep has no per-job payload to
 * hand off, so there is nothing a second class would own that this one
 * doesn't already have via DI.
 */
@Injectable()
@Processor(ABSENCE_NOTICE_SWEEP_QUEUE)
export class AbsenceNoticeScheduler extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(AbsenceNoticeScheduler.name);

  constructor(
    @InjectQueue(ABSENCE_NOTICE_SWEEP_QUEUE) private readonly queue: Queue,
    @InjectRepository(AttendanceSession)
    private readonly sessionRepo: Repository<AttendanceSession>,
    @InjectRepository(UserTenant)
    private readonly userTenantRepo: Repository<UserTenant>,
    private readonly schoolsService: SchoolsService,
    private readonly schoolCalendarService: SchoolCalendarService,
    private readonly absenceNoticeService: AbsenceNoticeService,
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    await this.queue.upsertJobScheduler(
      ABSENCE_NOTICE_SWEEP_JOB_ID,
      { every: ABSENCE_NOTICE_SWEEP_INTERVAL_MS },
      {
        opts: {
          removeOnComplete: true,
          removeOnFail: 100,
        },
      },
    );
    this.logger.log(`Scheduled absence-notice sweep every ${ABSENCE_NOTICE_SWEEP_INTERVAL_MS}ms`);
  }

  async process(): Promise<void> {
    const tenants = await this.schoolsService.findAll();
    for (const tenant of tenants) {
      // A slow or broken tenant must never block the rest of the sweep —
      // same isolation the communications processor gives a failing
      // provider.
      try {
        await this.sweepTenant(tenant.id);
      } catch (error) {
        this.logger.error(`Absence-notice sweep failed for tenant ${tenant.id}: ${String(error)}`);
      }
    }
  }

  private async sweepTenant(tenantId: string): Promise<void> {
    const settings = await this.schoolsService.getResolvedSettings(tenantId);
    const policy = resolveAttendancePolicy(settings);
    if (!policy.autoAbsentNotification.enabled) return;

    const timezone = settings.region?.timezone ?? 'UTC';
    const today = localToday(timezone);

    const nonWorkingDay = await this.schoolCalendarService.isNonWorkingDay({
      tenantId,
      date: today,
    });
    if (nonWorkingDay) return;

    if (localTimeHHmm(timezone) < policy.autoAbsentNotification.cutoffTime) return;

    // Registers never finalized are left alone. Auto-marking a whole
    // unmarked section absent and texting dozens of families about it is
    // the worst possible failure mode for this feature — the sweep only
    // ever notifies about registers a human already finalized.
    const sessions = await this.sessionRepo.find({
      where: {
        tenant_id: tenantId,
        date: today,
        period_no: IsNull(),
        state: AttendanceSessionState.FINALIZED,
        notified_at: IsNull(),
      },
    });
    if (sessions.length === 0) return;

    // `ReminderBatch.initiated_by_user_id` is not nullable, and stays that
    // way — a tenant with no ADMIN/EXECUTIVE user to attribute the batch to
    // has its sessions skipped and logged rather than the column being
    // relaxed for a system-initiated send.
    const initiator = await this.userTenantRepo.findOne({
      where: [
        { tenant_id: tenantId, role: UserRole.ADMIN },
        { tenant_id: tenantId, role: UserRole.EXECUTIVE },
      ],
      order: { created_at: 'ASC' },
    });
    if (!initiator) {
      this.logger.warn(
        `Tenant ${tenantId} has ${sessions.length} finalized, un-notified session(s) but no ` +
          'ADMIN/EXECUTIVE user to attribute the batch to — skipping.',
      );
      return;
    }

    for (const session of sessions) {
      try {
        await this.absenceNoticeService.sendAbsenceNotices({
          tenantId,
          sectionId: session.section_id,
          date: today,
          initiatedByUserId: initiator.user_id,
        });
      } catch (error) {
        this.logger.error(
          `Absence-notice send failed for session ${session.id} (tenant ${tenantId}): ${String(error)}`,
        );
      }
    }
  }
}
