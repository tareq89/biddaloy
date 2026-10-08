import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import type Redis from 'ioredis';
import { In, IsNull, LessThanOrEqual, MoreThanOrEqual, Repository } from 'typeorm';
import {
  LeaveStatus,
  LessonDeliveryReason,
  LessonDeliveryStatus,
  UserRole,
} from '@biddaloy/shared';
import { LessonDelivery } from './entities/lesson-delivery.entity';
import { LeaveRecord } from '../leave/entities/leave-record.entity';
import { Teacher } from '../academics/entities/teacher.entity';
import { RoutineSubstitution } from '../routines/entities/routine-substitution.entity';
import { ResolveRoutineService } from '../routines/resolve-routine.service';
import { SchoolsService } from '../schools/schools.service';
import { SchoolSettingsReader } from '../schools/settings/school-settings-reader.service';
import { SchoolCalendarService } from '../calendar/school-calendar.service';
import { BULK_IMPORT_REDIS } from '../bulk-import/import-staging.service';
import { localToday } from '../attendance/attendance-policy.util';
import { StudyPlansService } from './study-plans.service';

export const STUDY_PLAN_AUTO_DELIVERIES_QUEUE = 'study-plan-auto-deliveries';
export const STUDY_PLAN_AUTO_DELIVERIES_JOB_ID = 'study-plan-auto-deliveries';
const INTERVAL_MS = 15 * 60 * 1000;
const WINDOW_DAYS = 7; // today and the 7 days before (D29)
const MARKER_TTL_SEC = 3 * 24 * 3600;

function localTimeHHmm(timezone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date());
}

function addDays(dateIso: string, days: number): string {
  const d = new Date(`${dateIso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

interface AutoRow {
  section_id: string;
  subject_id: string;
  period_slot_id: string;
  date: string;
  reason: LessonDeliveryReason;
}

/**
 * [66.2/#2009] Once per school day after the status deadline, writes `auto`
 * NOT_TAUGHT rows for planned periods that could not happen: teacher on
 * approved leave with no substitute (ON_LEAVE) or a cancelled period
 * (CANCELLED). Never overwrites a person's row (ON CONFLICT DO NOTHING, D8).
 */
@Injectable()
@Processor(STUDY_PLAN_AUTO_DELIVERIES_QUEUE)
export class StudyPlanAutoDeliveriesScheduler extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(StudyPlanAutoDeliveriesScheduler.name);

  constructor(
    @InjectQueue(STUDY_PLAN_AUTO_DELIVERIES_QUEUE) private readonly queue: Queue,
    @InjectRepository(LeaveRecord) private readonly leaveRepo: Repository<LeaveRecord>,
    @InjectRepository(Teacher) private readonly teacherRepo: Repository<Teacher>,
    @InjectRepository(RoutineSubstitution)
    private readonly substitutionRepo: Repository<RoutineSubstitution>,
    @InjectRepository(LessonDelivery) private readonly deliveryRepo: Repository<LessonDelivery>,
    private readonly schoolsService: SchoolsService,
    private readonly settingsReader: SchoolSettingsReader,
    private readonly calendar: SchoolCalendarService,
    private readonly resolver: ResolveRoutineService,
    private readonly plans: StudyPlansService,
    @Inject(BULK_IMPORT_REDIS) private readonly redis: Redis,
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    await this.queue.upsertJobScheduler(
      STUDY_PLAN_AUTO_DELIVERIES_JOB_ID,
      { every: INTERVAL_MS },
      { opts: { removeOnComplete: true, removeOnFail: 100 } },
    );
  }

  async process(): Promise<void> {
    const tenants = await this.schoolsService.findAll();
    for (const tenant of tenants) {
      try {
        await this.sweepTenant(tenant.id);
      } catch (error) {
        this.logger.error(
          `Study-plan auto deliveries failed for tenant ${tenant.id}: ${String(error)}`,
        );
      }
    }
  }

  /** One tenant: gate (deadline, school day, once-a-day marker), then write. */
  async sweepTenant(tenantId: string): Promise<void> {
    const settings = await this.schoolsService.getResolvedSettings(tenantId);
    const timezone = settings.region?.timezone ?? 'UTC';
    const { statusDeadline } = await this.settingsReader.studyPlansSettings(tenantId);
    if (localTimeHHmm(timezone) < statusDeadline) return;

    const today = localToday(timezone);
    if (await this.calendar.isNonWorkingDay({ tenantId, date: today })) return;

    const key = `tenant:${tenantId}:study-plans:auto:${today}`;
    try {
      if ((await this.redis.set(key, '1', 'EX', MARKER_TTL_SEC, 'NX')) !== 'OK') return;
    } catch (error) {
      this.logger.warn(`Redis marker failed for tenant ${tenantId}, skipping: ${String(error)}`);
      return;
    }
    try {
      const count = await this.writeAutoRows(tenantId, addDays(today, -WINDOW_DAYS), today);
      this.logger.log(`Tenant ${tenantId}: ${count} auto delivery candidate(s) for ${today}`);
    } catch (error) {
      // A rerun is harmless (ON CONFLICT DO NOTHING), so let the next tick retry.
      await this.redis.del(key).catch(() => undefined);
      throw error;
    }
  }

  async writeAutoRows(tenantId: string, from: string, to: string): Promise<number> {
    // key = section|period|date; CANCELLED is added first so it wins over ON_LEAVE.
    const rows = new Map<string, AutoRow>();
    const add = (
      r: { section_id: string; subject_id: string; period_slot_id: string; date: string },
      reason: LessonDeliveryReason,
    ) => {
      const k = `${r.section_id}|${r.period_slot_id}|${r.date}`;
      if (!rows.has(k)) {
        rows.set(k, {
          section_id: r.section_id,
          subject_id: r.subject_id,
          period_slot_id: r.period_slot_id,
          date: r.date,
          reason,
        });
      }
    };

    const cancelled = await this.substitutionRepo
      .createQueryBuilder('s')
      .innerJoin('routine_slots', 'rs', 'rs.id = s.routine_slot_id AND rs.tenant_id = s.tenant_id')
      .select([
        's.date AS date',
        'rs.section_id AS section_id',
        'rs.subject_id AS subject_id',
        'rs.period_slot_id AS period_slot_id',
      ])
      .where('s.tenant_id = :tenantId AND s.is_cancelled = true', { tenantId })
      .andWhere('s.date BETWEEN :from AND :to', { from, to })
      .getRawMany<{
        date: string;
        section_id: string;
        subject_id: string;
        period_slot_id: string;
      }>();
    for (const c of cancelled) add(c, LessonDeliveryReason.CANCELLED);

    const leaves = await this.leaveRepo.find({
      where: {
        tenant_id: tenantId,
        status: LeaveStatus.APPROVED,
        start_date: LessThanOrEqual(to),
        end_date: MoreThanOrEqual(from),
      },
    });
    const teachers = leaves.length
      ? await this.teacherRepo.find({
          where: {
            tenant_id: tenantId,
            staff_profile_id: In(leaves.map((l) => l.staff_profile_id)),
            deleted_at: IsNull(),
          },
        })
      : [];
    const leavesByTeacher = new Map<string, LeaveRecord[]>();
    for (const t of teachers) {
      leavesByTeacher.set(
        t.id,
        leaves.filter((l) => l.staff_profile_id === t.staff_profile_id),
      );
    }
    const onLeave = (teacherId: string, date: string) =>
      (leavesByTeacher.get(teacherId) ?? []).some(
        (l) => l.start_date <= date && l.end_date >= date,
      );

    for (const teacherId of leavesByTeacher.keys()) {
      const slots = await this.resolver.resolveRoutine(
        { teacher_id: teacherId, from, to },
        tenantId,
        { role: UserRole.STUDENT, userId: '' },
      );
      for (const s of slots) {
        if (s.substituted || s.cancelled) continue;
        if (!s.teacher_ids.every((id) => onLeave(id, s.date))) continue;
        add(s, LessonDeliveryReason.ON_LEAVE);
      }
    }

    const planned: AutoRow[] = [];
    const hasPlan = new Map<string, boolean>();
    for (const r of rows.values()) {
      const k = `${r.section_id}|${r.subject_id}|${r.date}`;
      if (!hasPlan.has(k)) {
        const plan = await this.plans.currentPlanFor(tenantId, r.section_id, r.subject_id, r.date);
        hasPlan.set(k, !!plan);
      }
      if (hasPlan.get(k)) planned.push(r);
    }
    if (planned.length === 0) return 0;

    await this.deliveryRepo
      .createQueryBuilder()
      .insert()
      .into(LessonDelivery)
      .values(
        planned.map((r) => ({
          tenant_id: tenantId,
          section_id: r.section_id,
          subject_id: r.subject_id,
          period_slot_id: r.period_slot_id,
          date: r.date,
          status: LessonDeliveryStatus.NOT_TAUGHT,
          reason: r.reason,
          auto: true,
          recorded_by_user_id: null,
        })),
      )
      .orIgnore()
      .execute();
    return planned.length;
  }
}
