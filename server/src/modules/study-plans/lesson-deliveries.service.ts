import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, IsNull, Repository } from 'typeorm';
import {
  AuditAction,
  LessonDeliveryStatus,
  PeriodSlotKind,
  Permission,
  STUDY_PLAN_LIMITS,
  UserRole,
  hasTenantDataScope,
  roleHasPermission,
} from '@biddaloy/shared';
import { LessonDelivery } from './entities/lesson-delivery.entity';
import { PeriodSlot } from '../routines/entities/period-slot.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { Subject } from '../academics/entities/subject.entity';
import { Teacher } from '../academics/entities/teacher.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { ResolveRoutineService } from '../routines/resolve-routine.service';
import type { ResolvedSlot } from '../routines/dto/resolve.dto';
import { SchoolsService } from '../schools/schools.service';
import { AuditService } from '../audit/audit.service';
import { daysBetween, localToday } from '../attendance/attendance-policy.util';
import { StudyPlanCaller, StudyPlansService } from './study-plans.service';
import { PlanScheduleService } from './plan-schedule.service';
import type {
  ExtraLessonDeliveryDto,
  LessonDeliveriesDayDto,
  LessonDeliveryDto,
  LessonDeliveryPeriodDto,
  PutLessonDeliveryDto,
  SavedLessonDeliveryDto,
  TodayAllTaughtResponseDto,
} from './dto/lesson-delivery.dto';

function code(message: string, c: string) {
  return { message, details: { code: c } };
}
const outOfScope = (m: string) => new ForbiddenException(code(m, 'STUDY_PLAN_OUT_OF_SCOPE'));
const bad = (c: string, m: string) => new BadRequestException(code(m, c));
const notScheduled = () =>
  new UnprocessableEntityException(
    code(
      'That period is not scheduled for this section and subject on this date.',
      'LESSON_DELIVERY_NOT_SCHEDULED',
    ),
  );

interface Key {
  section_id: string;
  subject_id: string;
  date: string;
  period_slot_id: string;
}

/** [66.2.03/#2008] The daily teacher log: view my periods, mark them, log an extra class. */
@Injectable()
export class LessonDeliveriesService {
  constructor(
    @InjectRepository(LessonDelivery) private readonly repo: Repository<LessonDelivery>,
    @InjectRepository(PeriodSlot) private readonly slotRepo: Repository<PeriodSlot>,
    @InjectRepository(ClassSection) private readonly sectionRepo: Repository<ClassSection>,
    @InjectRepository(Teacher) private readonly teacherRepo: Repository<Teacher>,
    @InjectRepository(AcademicYear) private readonly yearRepo: Repository<AcademicYear>,
    private readonly resolver: ResolveRoutineService,
    private readonly schools: SchoolsService,
    private readonly audit: AuditService,
    private readonly plans: StudyPlansService,
    private readonly schedule: PlanScheduleService,
  ) {}

  // ---------------------------------------------------------------- helpers

  private async settings(tenantId: string) {
    const s = await this.schools.getResolvedSettings(tenantId);
    return {
      today: localToday(s.region?.timezone ?? 'UTC'),
      escalateAfter: s.studyPlans?.escalateAfterSchoolDays ?? 2,
    };
  }

  private async teacherIdOf(caller: StudyPlanCaller): Promise<string | null> {
    const t = await this.teacherRepo.findOne({
      where: { user_id: caller.userId, tenant_id: caller.tenantId, deleted_at: IsNull() },
      select: { id: true },
    });
    return t?.id ?? null;
  }

  private isAdmin(caller: StudyPlanCaller) {
    return (
      hasTenantDataScope(caller.role) && roleHasPermission(caller.role, Permission.SYLLABUS_MANAGE)
    );
  }

  /** Resolver slots of a section on one date (PUBLISHED routines only, breaks out). */
  private resolveSection(tenantId: string, sectionId: string, date: string) {
    return this.resolver.resolveRoutine({ section_id: sectionId, from: date, to: date }, tenantId, {
      role: UserRole.STUDENT,
      userId: '',
    });
  }

  private async existing(tenantId: string, k: Key, m?: EntityManager) {
    return (m ? m.getRepository(LessonDelivery) : this.repo).findOne({
      where: {
        tenant_id: tenantId,
        section_id: k.section_id,
        date: k.date,
        period_slot_id: k.period_slot_id,
      },
    });
  }

  private dto(r: LessonDelivery): LessonDeliveryDto {
    return {
      id: r.id,
      status: r.status,
      reason: r.reason,
      note: r.note,
      is_extra: r.is_extra,
      auto: r.auto,
      recorded_at: new Date(r.updated_at).toISOString(),
    };
  }

  private saved(r: LessonDelivery): SavedLessonDeliveryDto {
    return {
      ...this.dto(r),
      section_id: r.section_id,
      subject_id: r.subject_id,
      date: String(r.date).slice(0, 10),
      period_slot_id: r.period_slot_id,
    };
  }

  private async auditRow(
    caller: StudyPlanCaller,
    id: string,
    action: AuditAction,
    oldV: LessonDelivery | null,
    newV: LessonDelivery,
    m: EntityManager,
  ) {
    const snap = (r: LessonDelivery) => ({
      section_id: r.section_id,
      subject_id: r.subject_id,
      date: String(r.date).slice(0, 10),
      period_slot_id: r.period_slot_id,
      status: r.status,
      reason: r.reason,
      note: r.note,
      is_extra: r.is_extra,
      auto: r.auto,
    });
    await this.audit.record(
      {
        action,
        entity_type: 'LessonDelivery',
        entity_id: id,
        tenant_id: caller.tenantId,
        performed_by_user_id: caller.userId,
        ip_address: caller.context?.ip ?? null,
        user_agent: caller.context?.userAgent ?? null,
        old_values: oldV ? snap(oldV) : null,
        new_values: snap(newV),
      },
      m,
    );
  }

  /** D29: never the future; a teacher only back `teacherEditDays`. ADMIN: any past date. */
  private assertWindow(caller: StudyPlanCaller, date: string, today: string) {
    if (date > today) throw bad('LESSON_DELIVERY_FUTURE_DATE', 'You cannot record a future date.');
    if (!this.isAdmin(caller) && daysBetween(date, today) > STUDY_PLAN_LIMITS.teacherEditDays) {
      throw new ForbiddenException(
        code('This date is past the edit window.', 'LESSON_DELIVERY_WINDOW_CLOSED'),
      );
    }
  }

  /** Owner (D6) of section x subject for the date, or the substitute of `occ`. */
  private async assertOwnerOrSubstitute(
    caller: StudyPlanCaller,
    k: Key,
    occ: ResolvedSlot | undefined,
  ) {
    if (this.isAdmin(caller)) return;
    if (caller.role !== UserRole.TEACHER) throw outOfScope('You cannot record lesson deliveries.');
    const me = await this.teacherIdOf(caller);
    if (!me) throw outOfScope('You cannot record lesson deliveries.');
    if (occ?.substitute_teacher_id === me) return;
    const plan = await this.plans.currentPlanFor(
      caller.tenantId,
      k.section_id,
      k.subject_id,
      k.date,
    );
    const yearId =
      plan?.academic_year_id ??
      (
        await this.yearRepo
          .createQueryBuilder('y')
          .where('y.tenant_id = :t AND y.deleted_at IS NULL', { t: caller.tenantId })
          .andWhere('y.start_date <= :d AND y.end_date >= :d', { d: k.date })
          .getOne()
      )?.id;
    const owners = yearId
      ? await this.plans.ownerTeacherIds(
          caller.tenantId,
          k.section_id,
          k.subject_id,
          yearId,
          plan?.owner_override_teacher_id,
        )
      : [];
    if (!owners.includes(me)) throw outOfScope('You can only record subjects you own.');
  }

  private async assertSubject(tenantId: string, subjectId: string) {
    const found = await this.repo.manager
      .getRepository(Subject)
      .findOne({ where: { id: subjectId, tenant_id: tenantId }, select: { id: true } });
    if (!found) throw notScheduled();
  }

  // ---------------------------------------------------------------- PUT

  async put(
    dto: PutLessonDeliveryDto,
    tenantId: string,
    caller: StudyPlanCaller,
  ): Promise<SavedLessonDeliveryDto> {
    if (dto.status === LessonDeliveryStatus.NOT_TAUGHT ? !dto.reason : dto.reason) {
      throw bad('LESSON_DELIVERY_REASON', 'A reason is required when not taught, and only then.');
    }
    const { today } = await this.settings(tenantId);
    if (dto.date > today)
      throw bad('LESSON_DELIVERY_FUTURE_DATE', 'You cannot record a future date.');

    const occ = (await this.resolveSection(tenantId, dto.section_id, dto.date)).find(
      (o) =>
        o.period_slot_id === dto.period_slot_id && o.subject_id === dto.subject_id && !o.cancelled,
    );
    const prior = await this.existing(tenantId, dto);
    if (!occ && !(prior?.is_extra && prior.subject_id === dto.subject_id)) throw notScheduled();

    await this.assertSubject(tenantId, dto.subject_id);
    await this.assertOwnerOrSubstitute(caller, dto, occ);
    this.assertWindow(caller, dto.date, today);

    return this.repo.manager.transaction(async (m) => {
      const before = await this.existing(tenantId, dto, m);
      // The conflict key has no subject: never let a PUT retarget another subject's row.
      if (before && before.subject_id !== dto.subject_id) {
        throw new ConflictException(
          code(
            'That period already has a record for another subject.',
            'LESSON_DELIVERY_SLOT_TAKEN',
          ),
        );
      }
      if (before?.is_extra && dto.status !== LessonDeliveryStatus.TAUGHT) {
        throw bad('LESSON_DELIVERY_EXTRA_MUST_BE_TAUGHT', 'An extra class can only be taught.');
      }
      // One statement: two concurrent taps give one row (never find-then-save).
      const res = await m
        .createQueryBuilder()
        .insert()
        .into(LessonDelivery)
        .values({
          tenant_id: tenantId,
          section_id: dto.section_id,
          subject_id: dto.subject_id,
          date: dto.date,
          period_slot_id: dto.period_slot_id,
          status: dto.status,
          reason: dto.reason ?? null,
          note: dto.note ?? null,
          is_extra: false,
          auto: false,
          recorded_by_user_id: caller.userId,
        })
        .orUpdate(
          ['status', 'reason', 'note', 'auto', 'recorded_by_user_id', 'updated_at'],
          ['tenant_id', 'section_id', 'date', 'period_slot_id'],
        )
        .returning('*')
        .execute();
      const row = m.getRepository(LessonDelivery).create(res.raw[0] as Partial<LessonDelivery>);
      const fresh = (await this.existing(tenantId, dto, m)) ?? row;
      await this.auditRow(
        caller,
        fresh.id,
        before ? AuditAction.UPDATE : AuditAction.CREATE,
        before,
        fresh,
        m,
      );
      return this.saved(fresh);
    });
  }

  // ---------------------------------------------------------------- extra

  async extra(
    dto: ExtraLessonDeliveryDto,
    tenantId: string,
    caller: StudyPlanCaller,
  ): Promise<SavedLessonDeliveryDto> {
    const { today } = await this.settings(tenantId);
    const section = await this.sectionRepo.findOne({
      where: { id: dto.section_id, tenant_id: tenantId },
      relations: { class: true },
    });
    if (!section) throw notScheduled();
    // The slot must be a class period of the section's shift.
    const slot = await this.slotRepo.findOne({
      where: { id: dto.period_slot_id, tenant_id: tenantId },
    });
    const shiftId = section.class?.shift_id ?? null;
    if (!slot || slot.kind !== PeriodSlotKind.CLASS || (shiftId && slot.shift_id !== shiftId)) {
      throw new UnprocessableEntityException(
        code('That period is not in the section shift.', 'LESSON_DELIVERY_SLOT_NOT_IN_SHIFT'),
      );
    }
    await this.assertSubject(tenantId, dto.subject_id);
    await this.assertOwnerOrSubstitute(caller, dto, undefined);
    this.assertWindow(caller, dto.date, today);

    if (await this.existing(tenantId, dto)) {
      throw new ConflictException(
        code('That period already has a record.', 'LESSON_DELIVERY_SLOT_TAKEN'),
      );
    }
    const routine = (await this.resolveSection(tenantId, dto.section_id, dto.date)).find(
      (o) =>
        o.period_slot_id === dto.period_slot_id && o.subject_id === dto.subject_id && !o.cancelled,
    );
    if (routine) {
      throw new ConflictException(
        code(
          'This subject is already scheduled then; mark it instead.',
          'LESSON_DELIVERY_IS_ROUTINE_PERIOD',
        ),
      );
    }

    return this.repo.manager.transaction(async (m) => {
      let row: LessonDelivery;
      try {
        row = await m.getRepository(LessonDelivery).save(
          m.getRepository(LessonDelivery).create({
            tenant_id: tenantId,
            section_id: dto.section_id,
            subject_id: dto.subject_id,
            date: dto.date,
            period_slot_id: dto.period_slot_id,
            status: LessonDeliveryStatus.TAUGHT,
            reason: null,
            note: dto.note ?? null,
            is_extra: true,
            auto: false,
            recorded_by_user_id: caller.userId,
          }),
        );
      } catch (err) {
        if ((err as { code?: string } | null)?.code === '23505') {
          throw new ConflictException(
            code('That period already has a record.', 'LESSON_DELIVERY_SLOT_TAKEN'),
          );
        }
        throw err;
      }
      await this.auditRow(caller, row.id, AuditAction.CREATE, null, row, m);
      return this.saved(row);
    });
  }

  // ---------------------------------------------------------------- today's periods

  /** The caller's own + covering periods for a date, breaks out (resolver already drops them). */
  private async myPeriods(caller: StudyPlanCaller, date: string) {
    if (caller.role !== UserRole.TEACHER) throw outOfScope('Only teachers have a day view.');
    const me = await this.teacherIdOf(caller);
    if (!me) return [];
    return this.resolver.resolveRoutine({ teacher_id: me, from: date, to: date }, caller.tenantId, {
      role: caller.role,
      userId: caller.userId,
    });
  }

  private async rowsFor(tenantId: string, sectionIds: string[], date: string) {
    if (!sectionIds.length) return [];
    return this.repo.find({
      where: { tenant_id: tenantId, section_id: In(sectionIds), date },
    });
  }

  async markAllTaught(
    tenantId: string,
    caller: StudyPlanCaller,
  ): Promise<TodayAllTaughtResponseDto> {
    const { today } = await this.settings(tenantId);
    const periods = await this.myPeriods(caller, today);
    const rows = await this.rowsFor(
      tenantId,
      [...new Set(periods.map((p) => p.section_id))],
      today,
    );
    const taken = new Set(rows.map((r) => `${r.section_id}|${r.period_slot_id}`));
    const todo: ResolvedSlot[] = [];
    for (const p of periods) {
      if (p.cancelled || taken.has(`${p.section_id}|${p.period_slot_id}`)) continue;
      if (await this.plans.currentPlanFor(tenantId, p.section_id, p.subject_id, today))
        todo.push(p);
    }
    const created = await this.repo.manager.transaction(async (m) => {
      if (!todo.length) return [] as LessonDelivery[];
      const res = await m
        .createQueryBuilder()
        .insert()
        .into(LessonDelivery)
        .values(
          todo.map((p) => ({
            tenant_id: tenantId,
            section_id: p.section_id,
            subject_id: p.subject_id,
            date: today,
            period_slot_id: p.period_slot_id,
            status: LessonDeliveryStatus.TAUGHT,
            reason: null,
            note: null,
            is_extra: false,
            auto: false,
            recorded_by_user_id: caller.userId,
          })),
        )
        .orIgnore() // never overwrites a row that appeared meanwhile
        .returning('id')
        .execute();
      const ids = (res.raw as { id: string }[]).map((r) => r.id);
      const out = ids.length ? await m.getRepository(LessonDelivery).findBy({ id: In(ids) }) : [];
      for (const r of out) await this.auditRow(caller, r.id, AuditAction.CREATE, null, r, m);
      return out;
    });
    return {
      created: created.length,
      skipped: periods.length - created.length,
      deliveries: created.map((r) => this.saved(r)),
    };
  }

  // ---------------------------------------------------------------- GET

  async day(
    date: string,
    tenantId: string,
    caller: StudyPlanCaller,
  ): Promise<LessonDeliveriesDayDto> {
    const { escalateAfter } = await this.settings(tenantId);
    const periods = await this.myPeriods(caller, date);
    const sectionIds = [...new Set(periods.map((p) => p.section_id))];
    const [rows, sections, slots] = await Promise.all([
      this.rowsFor(tenantId, sectionIds, date),
      sectionIds.length
        ? this.sectionRepo.find({
            where: { id: In(sectionIds), tenant_id: tenantId },
            relations: { class: true },
            withDeleted: true,
          })
        : [],
      this.slotRepo.find({ where: { tenant_id: tenantId } }),
    ]);
    const rowAt = new Map(rows.map((r) => [`${r.section_id}|${r.period_slot_id}`, r]));
    const sectionName = new Map(
      sections.map((s) => [s.id, `${s.class?.name ?? ''} ${s.section_name}`.trim()]),
    );
    const slotAt = new Map(slots.map((s) => [s.id, s]));

    // One schedule per plan, shared by every period of that plan.
    const planOf = new Map<string, Awaited<ReturnType<StudyPlansService['currentPlanFor']>>>();
    for (const p of periods) {
      const k = `${p.section_id}|${p.subject_id}`;
      if (!planOf.has(k))
        planOf.set(k, await this.plans.currentPlanFor(tenantId, p.section_id, p.subject_id, date));
    }
    const schedules = new Map<string, Awaited<ReturnType<PlanScheduleService['scheduleFor']>>>();
    for (const plan of new Set([...planOf.values()].filter((x) => !!x))) {
      schedules.set(plan!.id, await this.schedule.scheduleFor(plan!, tenantId));
    }

    const me = await this.teacherIdOf(caller);
    const { today } = await this.settings(tenantId);
    const inWindow = date <= today && daysBetween(date, today) <= STUDY_PLAN_LIMITS.teacherEditDays;
    const out: LessonDeliveryPeriodDto[] = periods
      .map((p) => {
        const plan = planOf.get(`${p.section_id}|${p.subject_id}`) ?? null;
        const sch = plan ? schedules.get(plan.id) : undefined;
        let lesson: LessonDeliveryPeriodDto['lesson'] = null;
        if (plan && sch) {
          const at = sch.periods.find(
            (sp) => sp.date === date && sp.period_slot_id === p.period_slot_id && sp.lesson_id,
          );
          const idx = at ? sch.lessons.findIndex((l) => l.id === at.lesson_id) : -1;
          if (at && idx >= 0) {
            const l = sch.lessons[idx]!;
            const part =
              sch.periods
                .filter((sp) => sp.lesson_id === l.id)
                .filter(
                  (sp) =>
                    sp.date < date ||
                    (sp.date === date &&
                      slotSeq(slotAt, sp.period_slot_id) <= slotSeq(slotAt, p.period_slot_id)),
                ).length || 1;
            lesson = { id: l.id, number: idx + 1, title: l.title, part, of: l.periods };
          }
        }
        const row = rowAt.get(`${p.section_id}|${p.period_slot_id}`);
        const slot = slotAt.get(p.period_slot_id);
        return {
          section: { id: p.section_id, name: sectionName.get(p.section_id) ?? '' },
          subject: { id: p.subject_id, name_en: p.subject_name_en, name_bn: p.subject_name_bn },
          period_slot_id: p.period_slot_id,
          sequence: slot?.sequence ?? 0,
          starts_at: (slot?.starts_at ?? '').slice(0, 5),
          ends_at: (slot?.ends_at ?? '').slice(0, 5),
          routine_slot_id: p.routine_slot_id,
          substituting: !!me && p.substitute_teacher_id === me,
          cancelled: p.cancelled,
          plan_id: plan?.id ?? null,
          lesson,
          delivery: row ? this.dto(row) : null,
          can_mark: !p.cancelled && !!plan && inWindow,
        };
      })
      .sort((a, b) => a.sequence - b.sequence);

    // ponytail: "due" covers the plans on this day's page; widen to all owned plans if teachers miss it.
    let unreported = 0;
    let oldest: string | null = null;
    let schoolDays = 0;
    for (const s of schedules.values()) {
      unreported += s.summary.unreported_periods;
      schoolDays = Math.max(schoolDays, s.summary.unreported_school_days);
      const o = s.summary.oldest_unreported_date;
      if (o && (!oldest || o < oldest)) oldest = o;
    }
    return {
      date,
      periods: out,
      due: {
        unreported_periods: unreported,
        oldest_date: oldest,
        school_days_until_escalation: Math.max(0, escalateAfter - schoolDays),
      },
    };
  }
}

function slotSeq(m: Map<string, PeriodSlot>, id: string): number {
  return m.get(id)?.sequence ?? 0;
}
