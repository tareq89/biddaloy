import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, IsNull, Not, Repository } from 'typeorm';
import { AuditAction, SchoolStatus, TRIAL_EXPIRED_REASON } from '@biddaloy/shared';
import { School } from '../entities/school.entity';
import { TenantStatusService } from '../tenant-status.service';
import { AuditService } from '../../audit/audit.service';
import { AdminNoticeService } from './admin-notice.service';
import {
  DAY_MS,
  DEFAULT_TRIAL_DAYS,
  DEFAULT_TRIAL_SEAT_LIMIT,
  TRIAL_WARNINGS,
} from './trial.constants';

export interface ExtendTrialInput {
  days: number;
  /** Omitted = keep the current limit; `null` = unlimited. */
  seat_limit?: number | null;
  reason: string;
}

/** `userId: null` is the system actor (the daily job). */
export interface TrialActor {
  userId: string | null;
}

function envPositiveInt(config: ConfigService, name: string, fallback: number): number {
  const n = Number(config.get<string>(name));
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

@Injectable()
export class TrialService {
  private readonly logger = new Logger(TrialService.name);

  constructor(
    @InjectRepository(School) private readonly schools: Repository<School>,
    private readonly config: ConfigService,
    private readonly tenantStatus: TenantStatusService,
    private readonly notices: AdminNoticeService,
    private readonly audit: AuditService,
  ) {}

  /** Starts the trial for a new school. Runs on the caller's transaction manager. */
  async startTrial(schoolId: string, manager: EntityManager, now = new Date()): Promise<void> {
    const days = envPositiveInt(this.config, 'TRIAL_DAYS', DEFAULT_TRIAL_DAYS);
    await manager.update(School, schoolId, {
      trial_ends_at: new Date(now.getTime() + days * DAY_MS),
      seat_limit: envPositiveInt(this.config, 'TRIAL_SEAT_LIMIT', DEFAULT_TRIAL_SEAT_LIMIT),
    });
  }

  /** Pushes the end date out, and reactivates a school the trial had suspended. */
  async extend(
    schoolId: string,
    input: ExtendTrialInput,
    actor: TrialActor,
    now = new Date(),
  ): Promise<School> {
    const school = await this.schools.findOne({ where: { id: schoolId } });
    if (!school) throw new NotFoundException('School not found');

    const base = Math.max(now.getTime(), school.trial_ends_at?.getTime() ?? 0);
    const wasExpired =
      school.status === SchoolStatus.SUSPENDED && school.status_reason === TRIAL_EXPIRED_REASON;
    const patch: Partial<School> = {
      trial_ends_at: new Date(base + input.days * DAY_MS),
      onboarding: { ...(school.onboarding ?? {}), trial_warnings: [] },
    };
    if (input.seat_limit !== undefined) patch.seat_limit = input.seat_limit;
    if (wasExpired) {
      patch.status = SchoolStatus.ACTIVE;
      patch.status_reason = null;
      patch.status_changed_at = now;
    }
    await this.schools.update(schoolId, patch);
    await this.tenantStatus.invalidate(schoolId);

    await this.audit.record({
      action: AuditAction.UPDATE,
      entity_type: 'Trial',
      entity_id: schoolId,
      tenant_id: schoolId,
      performed_by_user_id: actor.userId,
      old_values: { trial_ends_at: school.trial_ends_at, seat_limit: school.seat_limit },
      new_values: {
        event: 'TRIAL_EXTENDED',
        trial_ends_at: patch.trial_ends_at,
        seat_limit: patch.seat_limit ?? school.seat_limit,
        reactivated: wasExpired,
        reason: input.reason,
      },
    });
    return this.schools.findOneOrFail({ where: { id: schoolId } });
  }

  /** The daily job: warn at 7 and 2 days out, suspend at the end. Schools without a trial are never read. */
  async runDaily(now: Date): Promise<void> {
    const due = await this.schools.find({
      where: { trial_ends_at: Not(IsNull()), status: SchoolStatus.ACTIVE },
    });
    for (const school of due) {
      try {
        if (school.trial_ends_at!.getTime() <= now.getTime()) await this.expire(school, now);
        else await this.warn(school, now);
      } catch (err) {
        // One school's failure must not stop the rest; the next daily run retries it.
        this.logger.error(
          `Trial job failed for school ${school.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  private async warn(school: School, now: Date): Promise<void> {
    const sent: string[] = school.onboarding?.trial_warnings ?? [];
    const daysLeft = Math.ceil((school.trial_ends_at!.getTime() - now.getTime()) / DAY_MS);
    // Most urgent first; once a closer warning goes out the farther one is moot.
    const next = [...TRIAL_WARNINGS]
      .reverse()
      .find((w) => daysLeft <= w.days && !sent.includes(w.key));
    if (!next) return;
    const skipped = TRIAL_WARNINGS.filter((w) => w.days > next.days).map((w) => w.key);
    // Remember before sending: a crash mid-send must never re-send on the next run.
    await this.schools.update(school.id, {
      onboarding: {
        ...(school.onboarding ?? {}),
        trial_warnings: [...new Set([...sent, next.key, ...skipped])],
      },
    });
    await this.notices.notifyAdmins(school.id, next.template, {
      date: school.trial_ends_at!.toISOString().slice(0, 10),
    });
  }

  private async expire(school: School, now: Date): Promise<void> {
    // The status guard makes a concurrent run / extend win cleanly instead of being overwritten.
    const res = await this.schools.update(
      { id: school.id, status: SchoolStatus.ACTIVE },
      {
        status: SchoolStatus.SUSPENDED,
        status_reason: TRIAL_EXPIRED_REASON,
        status_changed_at: now,
      },
    );
    if (!res.affected) return;
    await this.tenantStatus.invalidate(school.id);
    await this.notices.notifyAdmins(school.id, 'trial_ended');
    await this.audit.record({
      action: AuditAction.UPDATE,
      entity_type: 'Trial',
      entity_id: school.id,
      tenant_id: school.id,
      performed_by_user_id: null,
      new_values: { event: 'TRIAL_EXPIRED', trial_ends_at: school.trial_ends_at },
    });
  }
}
