import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import type Redis from 'ioredis';
import { randomUUID } from 'crypto';
import { In, Repository } from 'typeorm';
import {
  CommunicationMedium,
  EnrollmentStatus,
  UserRole,
  UserStatus,
  countSmsSegments,
} from '@biddaloy/shared';
import type { StudyPlansSettings } from '@biddaloy/shared';
import { StudyPlan } from './entities/study-plan.entity';
import { Student } from '../students/entities/student.entity';
import { UserTenant } from '../auth/entities/user-tenant.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { BULK_IMPORT_REDIS } from '../bulk-import/import-staging.service';
import { SchoolsService } from '../schools/schools.service';
import { SchoolSettingsReader } from '../schools/settings/school-settings-reader.service';
import { SchoolCalendarService } from '../calendar/school-calendar.service';
import { PushService } from '../push/push.service';
import { CommunicationsService } from '../communications/communications.service';
import { SmsCreditService } from '../communications/credits/sms-credit.service';
import {
  addDays,
  isWeeklyOff,
  localTimeHHmm,
  localToday,
  resolveAttendancePolicy,
} from '../attendance/attendance-policy.util';
import { PlanScheduleService } from './plan-schedule.service';
import { StudyPlansService } from './study-plans.service';
import {
  FLAG_TITLES,
  FLAG_URLS,
  committeeLine,
  escalationBody,
  guardianBody,
  teacherReminderBody,
} from './study-plan-flags.messages';

export const STUDY_PLAN_FLAGS_QUEUE = 'study-plan-flags';
export const STUDY_PLAN_FLAGS_JOB_ID = 'study-plan-flags';
export const STUDY_PLAN_FLAGS_INTERVAL_MS = 15 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;
const DAYS_3 = 3 * 24 * 60 * 60;
const DAYS_9 = 9 * 24 * 60 * 60;

/** One unreported period, charged to one teacher. */
export interface UnreportedRow {
  date: string;
  teacherId: string;
}

export { addDays };

/** ISO year-week of a calendar date, e.g. `2026-W42`. */
export function isoYearWeek(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  const dow = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dow); // Thursday of this ISO week
  const year = t.getUTCFullYear();
  const week = Math.ceil(((t.getTime() - Date.UTC(year, 0, 1)) / DAY_MS + 1) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

/**
 * [66.2.05/#2010] The study-plan flag ladder (D3, D25, D26): teacher reminder,
 * EXECUTIVE+ADMIN escalation, weekly guardian/COMMITTEE digest. A 15-minute
 * sweep acts once the school's local time has passed the configured hour;
 * a Redis marker per tenant / kind / local date (SET NX, taken BEFORE sending)
 * keeps each kind at most once. A missed send is cheaper than a duplicate.
 */
@Injectable()
@Processor(STUDY_PLAN_FLAGS_QUEUE)
export class StudyPlanFlagsScheduler extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(StudyPlanFlagsScheduler.name);

  constructor(
    @InjectQueue(STUDY_PLAN_FLAGS_QUEUE) private readonly queue: Queue,
    @InjectRepository(StudyPlan) private readonly planRepo: Repository<StudyPlan>,
    @InjectRepository(Student) private readonly studentRepo: Repository<Student>,
    @InjectRepository(UserTenant) private readonly memberships: Repository<UserTenant>,
    @InjectRepository(AcademicYear) private readonly yearRepo: Repository<AcademicYear>,
    @Inject(BULK_IMPORT_REDIS) private readonly redis: Redis,
    private readonly schools: SchoolsService,
    private readonly settingsReader: SchoolSettingsReader,
    private readonly calendar: SchoolCalendarService,
    private readonly schedule: PlanScheduleService,
    private readonly plans: StudyPlansService,
    private readonly push: PushService,
    private readonly communications: CommunicationsService,
    private readonly smsCredit: SmsCreditService,
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    await this.queue.upsertJobScheduler(
      STUDY_PLAN_FLAGS_JOB_ID,
      { every: STUDY_PLAN_FLAGS_INTERVAL_MS },
      { opts: { removeOnComplete: true, removeOnFail: 100 } },
    );
  }

  async process(): Promise<void> {
    const tenants = await this.schools.findAll();
    for (const tenant of tenants) {
      try {
        await this.sweepTenant(tenant.id);
      } catch (error) {
        this.logger.error(`Study-plan flags failed for tenant ${tenant.id}: ${String(error)}`);
      }
    }
  }

  /** SET NX with expiry; true only for the first caller. */
  private async claim(key: string, ttlSeconds: number): Promise<boolean> {
    return (await this.redis.set(key, '1', 'EX', ttlSeconds, 'NX')) === 'OK';
  }

  async sweepTenant(tenantId: string): Promise<void> {
    const settings = await this.settingsReader.studyPlansSettings(tenantId);
    const resolved = await this.schools.getResolvedSettings(tenantId);
    const tz = resolved.region?.timezone ?? 'UTC';
    const today = localToday(tz);
    const now = localTimeHHmm(tz);
    const base = `tenant:${tenantId}:study-plans`;

    // Skip everything on a non-working day (no reminder, escalation or digest).
    if (await this.calendar.isNonWorkingDay({ tenantId, date: today })) return;

    const doReminder =
      now >= settings.reminderTime && (await this.claim(`${base}:reminder:${today}`, DAYS_3));
    const doEscalate =
      now >= settings.reminderTime && (await this.claim(`${base}:escalate:${today}`, DAYS_3));
    if (doReminder || doEscalate) {
      const rows = await this.collectUnreported(tenantId);
      if (doReminder) await this.runReminder(tenantId, today, rows);
      if (doEscalate) await this.runEscalation(tenantId, today, rows, settings);
    }

    if (now >= settings.weeklyDigestTime && (await this.isLastWorkingDayOfWeek(tenantId, today))) {
      const week = isoYearWeek(today);
      const key = `${base}:digest:${week}`;
      if (await this.claim(key, DAYS_9)) {
        try {
          await this.runDigest(tenantId, settings);
        } catch (error) {
          // Sends never throw (safePush / caught enqueue), so a throw is a failed
          // read: give the week back so the next sweep retries.
          await this.redis.del(key);
          throw error;
        }
      }
    }
  }

  // ---------------------------------------------------------------- calendar

  /** Working days strictly before `today`, ascending (45-day look-back). */
  private async workingDaysBefore(tenantId: string, today: string): Promise<string[]> {
    const { dates } = await this.calendar.getWorkingDays({
      tenantId,
      from: addDays(today, -45),
      to: addDays(today, -1),
    });
    return [...dates].sort();
  }

  /**
   * Today is a working day and no working day lies between tomorrow and the
   * next weekly-off day. No weekly-off day at all => never.
   * ponytail: a school with no weekly-off day gets no digest; add a setting if one asks.
   */
  async isLastWorkingDayOfWeek(tenantId: string, today: string): Promise<boolean> {
    const resolved = await this.schools.getResolvedSettings(tenantId);
    const policy = resolveAttendancePolicy(resolved);
    let off: string | null = null;
    for (let i = 1; i <= 7; i++) {
      const d = addDays(today, i);
      if (isWeeklyOff(d, policy)) {
        off = d;
        break;
      }
    }
    if (!off) return false;
    const from = addDays(today, 1);
    const to = addDays(off, -1);
    if (from > to) return true;
    const { count } = await this.calendar.getWorkingDays({ tenantId, from, to });
    return count === 0;
  }

  // ---------------------------------------------------------------- reminder + escalation

  private async currentYearId(tenantId: string): Promise<string | null> {
    const year = await this.yearRepo.findOne({ where: { tenant_id: tenantId, is_current: true } });
    return year?.id ?? null;
  }

  /**
   * Unreported periods of every live plan of the current year, one row per
   * (period, responsible teacher): the occurrence's substitute, else the plan owners.
   * ponytail: one `scheduleFor` (one resolver call) per plan; group by section if it gets slow.
   */
  async collectUnreported(tenantId: string): Promise<UnreportedRow[]> {
    const yearId = await this.currentYearId(tenantId);
    if (!yearId) return [];
    const plans = await this.planRepo.find({
      where: { tenant_id: tenantId, academic_year_id: yearId },
    });
    const rows: UnreportedRow[] = [];
    for (const plan of plans) {
      try {
        const sched = await this.schedule.scheduleFor(plan, tenantId);
        const unreported = sched.periods.filter((p) => p.status === 'UNREPORTED');
        if (!unreported.length) continue;
        const owners = await this.plans.ownerTeacherIds(
          tenantId,
          plan.section_id,
          plan.subject_id,
          plan.academic_year_id,
          plan.owner_override_teacher_id,
        );
        for (const p of unreported) {
          const teachers = p.substitute_teacher_id ? [p.substitute_teacher_id] : owners;
          for (const teacherId of teachers) rows.push({ date: p.date, teacherId });
        }
      } catch (error) {
        this.logger.warn(`Unreported scan skipped plan ${plan.id}: ${String(error)}`);
      }
    }
    return rows;
  }

  /** ACTIVE user ids of the given teachers, tenant-scoped. */
  private async teacherUserIds(
    tenantId: string,
    teacherIds: string[],
  ): Promise<Map<string, string>> {
    if (!teacherIds.length) return new Map();
    const rows: { id: string; user_id: string }[] = await this.planRepo.manager.query(
      `SELECT t.id, t.user_id
         FROM teachers t
         JOIN users u ON u.id = t.user_id
        WHERE t.tenant_id = $1 AND t.id = ANY($2) AND t.deleted_at IS NULL AND u.status = $3`,
      [tenantId, teacherIds, UserStatus.ACTIVE],
    );
    return new Map(rows.map((r) => [r.id, r.user_id]));
  }

  private async safePush(
    userId: string,
    tenantId: string,
    payload: { type: string; title: string; body: string; url: string },
  ): Promise<void> {
    try {
      await this.push.sendToUser(userId, tenantId, payload);
    } catch (error) {
      this.logger.warn(`study-plan push failed for ${userId}: ${String(error)}`);
    }
  }

  /** Previous working day's unreported periods -> one push per teacher user. */
  async runReminder(tenantId: string, today: string, rows: UnreportedRow[]): Promise<void> {
    const before = await this.workingDaysBefore(tenantId, today);
    const prev = before[before.length - 1];
    if (!prev) return;
    const perTeacher = new Map<string, number>();
    for (const r of rows) {
      if (r.date === prev) perTeacher.set(r.teacherId, (perTeacher.get(r.teacherId) ?? 0) + 1);
    }
    const users = await this.teacherUserIds(tenantId, [...perTeacher.keys()]);
    for (const [teacherId, count] of perTeacher) {
      const userId = users.get(teacherId);
      if (!userId) continue;
      await this.safePush(userId, tenantId, {
        type: 'study-plan.unreported',
        title: FLAG_TITLES.reminder,
        body: teacherReminderBody(count),
        url: FLAG_URLS.teacher,
      });
    }
  }

  /** Teachers with a period unreported for `escalateAfterSchoolDays` school days -> ADMIN + EXECUTIVE. */
  async runEscalation(
    tenantId: string,
    today: string,
    rows: UnreportedRow[],
    settings: Pick<StudyPlansSettings, 'escalateAfterSchoolDays'>,
  ): Promise<void> {
    const n = settings.escalateAfterSchoolDays;
    const before = await this.workingDaysBefore(tenantId, today);
    const cutoff = before[before.length - n];
    if (!cutoff) return;
    const lateIds = [...new Set(rows.filter((r) => r.date <= cutoff).map((r) => r.teacherId))];
    // Only teachers with an ACTIVE user count, as in the reminder.
    const late = await this.teacherUserIds(tenantId, lateIds);
    if (!late.size) return;
    const recipients = await this.usersWithRoles(tenantId, [UserRole.ADMIN, UserRole.EXECUTIVE]);
    for (const user of recipients) {
      await this.safePush(user.id, tenantId, {
        type: 'study-plan.unreported',
        title: FLAG_TITLES.escalation,
        body: escalationBody(late.size, n),
        url: FLAG_URLS.escalation,
      });
    }
  }

  /** Distinct ACTIVE users holding any of `roles` in the tenant. */
  private async usersWithRoles(
    tenantId: string,
    roles: UserRole[],
  ): Promise<{ id: string; phone: string | null; full_name: string }[]> {
    const held = await this.memberships.find({
      where: { tenant_id: tenantId, role: In(roles) },
      relations: { user: true },
    });
    const users = held.map((h) => h.user).filter((u) => u && u.status === UserStatus.ACTIVE);
    return [...new Map(users.map((u) => [u.id, u])).values()];
  }

  // ---------------------------------------------------------------- digest

  async runDigest(tenantId: string, settings: StudyPlansSettings): Promise<void> {
    const yearId = await this.currentYearId(tenantId);
    if (!yearId) return;
    // A live plan can sit on a soft-deleted section (STUDY_PLAN_SECTION_GONE): its join is empty.
    const plans = (
      await this.planRepo.find({
        where: { tenant_id: tenantId, academic_year_id: yearId },
        relations: { subject: true, section: { class: true } },
      })
    ).filter((p) => p.section?.class && p.subject);
    if (!plans.length) return;
    const summaries = await this.schedule.summarize(plans, tenantId);

    const bySection = new Map<string, { behind: { subject: string; periods: number }[] }>();
    const byClass = new Map<string, { total: number; behind: number }>();
    const sectionLabel = new Map<string, string>();
    for (const p of plans) {
      const cls = byClass.get(p.section.class.name) ?? { total: 0, behind: 0 };
      cls.total++;
      const periods = summaries.get(p.id)?.periods_behind ?? 0;
      if (periods > 0) {
        cls.behind++;
        const s = bySection.get(p.section_id) ?? { behind: [] };
        s.behind.push({ subject: p.subject.name_bn ?? p.subject.name_en, periods });
        bySection.set(p.section_id, s);
      }
      byClass.set(p.section.class.name, cls);
      sectionLabel.set(p.section_id, `${p.section.class.name}-${p.section.section_name}`);
    }

    await this.digestGuardians(tenantId, settings, bySection, sectionLabel);
    await this.digestCommittee(tenantId, byClass);
  }

  private async digestGuardians(
    tenantId: string,
    settings: StudyPlansSettings,
    bySection: Map<string, { behind: { subject: string; periods: number }[] }>,
    sectionLabel: Map<string, string>,
  ): Promise<void> {
    if (!bySection.size) return;
    const students = await this.studentRepo.find({
      where: {
        tenant_id: tenantId,
        enrollment_status: EnrollmentStatus.ACTIVE,
        class_section_id: In([...bySection.keys()]),
      },
      relations: { guardians: true },
    });

    // Guardian users must be ACTIVE; one lookup for all of them.
    const guardianUserIds = [
      ...new Set(
        students.flatMap((s) =>
          s.guardians.filter((g) => g.tenant_id === tenantId && g.user_id).map((g) => g.user_id!),
        ),
      ),
    ];
    const active = new Set<string>(
      guardianUserIds.length
        ? (
            await this.planRepo.manager.query(
              `SELECT id FROM users WHERE id = ANY($1) AND status = $2`,
              [guardianUserIds, UserStatus.ACTIVE],
            )
          ).map((r: { id: string }) => r.id)
        : [],
    );

    const messages: {
      userId: string;
      phone: string | null;
      name: string;
      studentId: string;
      body: string;
    }[] = [];
    for (const s of students) {
      const behind = bySection.get(s.class_section_id)?.behind;
      if (!behind) continue; // child with nothing behind: no message
      const body = guardianBody(
        s.full_name_bn ?? s.full_name,
        sectionLabel.get(s.class_section_id) ?? '',
        behind,
      );
      for (const g of s.guardians) {
        if (g.tenant_id !== tenantId || !g.user_id || !active.has(g.user_id)) continue;
        messages.push({
          userId: g.user_id,
          phone: g.phone,
          name: g.full_name,
          studentId: s.id,
          body,
        });
      }
    }
    if (!messages.length) return;

    // Resolve the sender first: with none, skip SMS without reserving credits.
    const initiator = (
      await this.usersWithRoles(tenantId, [UserRole.ADMIN, UserRole.EXECUTIVE])
    )[0];
    const sms = initiator
      ? await this.reserveSms(
          tenantId,
          settings,
          messages.filter((m) => m.phone).map((m) => m.body),
        )
      : { on: false as const, batchId: undefined };

    for (const m of messages) {
      await this.safePush(m.userId, tenantId, {
        type: 'study-plan.digest',
        title: FLAG_TITLES.guardian,
        body: m.body,
        url: FLAG_URLS.guardian(m.studentId),
      });
      if (sms.on && initiator && m.phone) {
        await this.communications
          .enqueue(
            {
              medium: CommunicationMedium.SMS,
              recipient_address: m.phone,
              recipient_name: m.name,
              message_body: m.body,
            },
            tenantId,
            initiator.id,
            sms.batchId
              ? { batchId: sms.batchId, segments: countSmsSegments(m.body).segments }
              : undefined,
          )
          .catch((e) => this.logger.warn(`study-plan digest sms failed: ${String(e)}`));
      }
    }
  }

  /** COMMITTEE: one push, one line per class that has a plan behind; no teacher names. */
  private async digestCommittee(
    tenantId: string,
    byClass: Map<string, { total: number; behind: number }>,
  ): Promise<void> {
    const lines = [...byClass]
      .filter(([, v]) => v.behind > 0)
      .map(([name, v]) => committeeLine(name, v.total, v.behind));
    if (!lines.length) return;
    for (const user of await this.usersWithRoles(tenantId, [UserRole.COMMITTEE])) {
      await this.safePush(user.id, tenantId, {
        type: 'study-plan.digest',
        title: FLAG_TITLES.committee,
        body: lines.join('\n'),
        url: FLAG_URLS.committee,
      });
    }
  }

  /**
   * D26: SMS only when opted in AND a provider is configured. Metered tenants
   * reserve once per digest run: the sum of every message's own segments under
   * a fresh batch id, so `settlePart` caps each settle at this run's reserve.
   * The Redis week marker is what keeps it once a week. On failure SMS is
   * skipped and push still goes.
   */
  private async reserveSms(
    tenantId: string,
    settings: StudyPlansSettings,
    bodies: string[],
  ): Promise<{ on: boolean; batchId?: string }> {
    try {
      if (!settings.guardianDigestSms || bodies.length === 0) return { on: false };
      const resolved = await this.schools.getResolvedSettings(tenantId);
      if (!resolved.communications?.sms?.provider) return { on: false };
      if (!(await this.smsCredit.isMetered(tenantId))) return { on: true };
      const total = bodies.reduce((n, b) => n + countSmsSegments(b).segments, 0);
      const batchId = randomUUID();
      const res = await this.smsCredit.reserve(tenantId, total, `batch:${batchId}`, {
        type: 'batch',
        id: batchId,
      });
      return res.ok ? { on: true, batchId } : { on: false };
    } catch (e) {
      this.logger.warn(`study-plan digest sms setup failed: ${String(e)}`);
      return { on: false };
    }
  }
}
