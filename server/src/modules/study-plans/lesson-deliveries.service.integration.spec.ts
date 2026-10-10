import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from 'vitest';
import { ConfigModule } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { SEED_TENANT_ID } from '@test/constants';
import { PeriodSlotKind, RoutineState, SlotRecurrence, UserRole } from '@biddaloy/shared';
import { LessonDeliveriesService } from './lesson-deliveries.service';
import { PlanScheduleService } from './plan-schedule.service';
import { StudyPlansService, StudyPlanCaller } from './study-plans.service';
import { TeacherScopeService } from '../classes/teacher-scope.service';
import { AuditService } from '../audit/audit.service';
import { ResolveRoutineService } from '../routines/resolve-routine.service';
import { SchoolsService } from '../schools/schools.service';
import { CalendarModule } from '../calendar/calendar.module';
import { AuthModule } from '../auth/auth.module';
import { School } from '../schools/entities/school.entity';
import { User } from '../users/entities/user.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { Class } from '../academics/entities/class.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { Subject } from '../academics/entities/subject.entity';
import { Teacher } from '../academics/entities/teacher.entity';
import { Shift } from '../routines/entities/shift.entity';
import { PeriodSlot } from '../routines/entities/period-slot.entity';
import { Routine } from '../routines/entities/routine.entity';
import { RoutineSlot } from '../routines/entities/routine-slot.entity';
import { RoutineSlotTeacher } from '../routines/entities/routine-slot-teacher.entity';
import { RoutineSubstitution } from '../routines/entities/routine-substitution.entity';
import { StudyPlan } from './entities/study-plan.entity';
import { LessonDelivery } from './entities/lesson-delivery.entity';

/**
 * [66.2.03/#2008] Real DB, real resolver. Year 2046; Mon 03-12, Tue 03-13, Wed 03-14.
 * "Now" is Wed 2046-03-14 noon in Dhaka. Routine: five periods on Mon/Tue/Wed,
 * P1..P5, subject X in P1, P2, P4, P5 and subject Y in P3 (Y has no plan).
 */
describe('LessonDeliveriesService (integration)', () => {
  let ds: DataSource;
  let service: LessonDeliveriesService;
  const TENANT_B = '00000000-0000-4000-8000-0000000066c8';
  const TUE = '2046-03-13';
  const WED = '2046-03-14';

  let yearId: string;
  let sectionId: string;
  let subjectX: string;
  let subjectY: string;
  let periods: string[]; // P1..P5
  let slotIds: Record<string, string>; // `${weekday}|${periodIndex}` -> routine slot
  let owner: StudyPlanCaller;
  let co: StudyPlanCaller;
  let unrelated: StudyPlanCaller;
  let sub: StudyPlanCaller;
  let admin: StudyPlanCaller;
  let teacherIds: Record<string, string>;
  let planId: string;

  beforeAll(async () => {
    const module = await createTestModule(
      ALL_ENTITIES,
      [
        LessonDeliveriesService,
        PlanScheduleService,
        ResolveRoutineService,
        StudyPlansService,
        TeacherScopeService,
        AuditService,
        {
          provide: SchoolsService,
          useValue: {
            getResolvedSettings: async () => ({
              region: { timezone: 'Asia/Dhaka' },
              studyPlans: { escalateAfterSchoolDays: 2 },
            }),
          },
        },
      ],
      [ConfigModule.forRoot({ isGlobal: true }), CalendarModule, AuthModule],
    );
    ds = module.get<DataSource>(getDataSourceToken());
    service = module.get(LessonDeliveriesService);
    if (!(await ds.getRepository(School).findOne({ where: { id: TENANT_B } }))) {
      await ds.getRepository(School).save({ id: TENANT_B, name: 'LD Other', slug: 'ld-other-68' });
    }
    const where = { tenant_id: SEED_TENANT_ID, name: 'LD Deliveries 2046' };
    yearId = (
      (await ds.getRepository(AcademicYear).findOne({ where })) ??
      (await ds.getRepository(AcademicYear).save({
        ...where,
        start_date: '2046-01-01',
        end_date: '2046-12-31',
        is_current: false,
      }))
    ).id;
  }, 60000);

  afterAll(async () => {
    await ds.destroy();
  });

  afterEach(() => vi.useRealTimers());

  async function makeTeacher(tag: string, role: string = UserRole.TEACHER) {
    const user = await ds.getRepository(User).save({
      email: `ld-${tag}-${Date.now()}-${Math.random()}@test.com`,
      full_name: `LD ${tag}`,
    });
    let teacherId = '';
    if (role === UserRole.TEACHER) {
      teacherId = (
        await ds.getRepository(Teacher).save({
          user_id: user.id,
          employee_id: `EMP-LD-${tag}-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
          tenant_id: SEED_TENANT_ID,
          designations: [],
        })
      ).id;
    }
    const caller: StudyPlanCaller = { userId: user.id, tenantId: SEED_TENANT_ID, role };
    return { caller, teacherId };
  }

  async function slot(weekday: number, p: number, subjectId: string, routineId: string) {
    const s = await ds.getRepository(RoutineSlot).save({
      tenant_id: SEED_TENANT_ID,
      routine_id: routineId,
      section_id: sectionId,
      period_slot_id: periods[p]!,
      weekday,
      subject_id: subjectId,
      recurrence: SlotRecurrence.WEEKLY,
      recurrence_offset: 0,
      valid_from: '2046-01-01',
      valid_to: null,
    });
    await ds
      .getRepository(RoutineSlotTeacher)
      .save({ tenant_id: SEED_TENANT_ID, routine_slot_id: s.id, teacher_id: teacherIds.owner! });
    slotIds[`${weekday}|${p}`] = s.id;
  }

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2046-03-14T06:00:00Z'));
    await ds.query('DELETE FROM calendar_events');
    await ds
      .getRepository(School)
      .update(
        { id: SEED_TENANT_ID },
        { settings: { version: 1, attendance: { weeklyOffDays: [] } } as never },
      );
    const suffix = Math.random().toString(36).slice(2, 8);
    const c = await ds
      .getRepository(Class)
      .save({ name: `Ten ${suffix}`, academic_year_id: yearId, tenant_id: SEED_TENANT_ID });
    sectionId = (
      await ds
        .getRepository(ClassSection)
        .save({ class_id: c.id, section_name: 'A', tenant_id: SEED_TENANT_ID })
    ).id;
    const subj = async (code: string) =>
      (
        await ds.getRepository(Subject).save({
          tenant_id: SEED_TENANT_ID,
          code: `${code}${suffix}`,
          name_en: `${code} ${suffix}`,
          name_bn: 'বি',
        })
      ).id;
    subjectX = await subj('X');
    subjectY = await subj('Y');

    const o = await makeTeacher('owner');
    const co2 = await makeTeacher('co');
    const un = await makeTeacher('unrelated');
    const sb = await makeTeacher('sub');
    owner = o.caller;
    co = co2.caller;
    unrelated = un.caller;
    sub = sb.caller;
    admin = (await makeTeacher('admin', UserRole.ADMIN)).caller;
    teacherIds = {
      owner: o.teacherId,
      co: co2.teacherId,
      unrelated: un.teacherId,
      sub: sb.teacherId,
    };

    const shift = await ds.getRepository(Shift).save({
      tenant_id: SEED_TENANT_ID,
      name: `LD-${suffix}`,
      day_starts_at: '08:00:00',
      day_ends_at: '14:00:00',
      sequence: 0,
    });
    periods = [];
    for (let i = 0; i < 5; i++) {
      periods.push(
        (
          await ds.getRepository(PeriodSlot).save({
            tenant_id: SEED_TENANT_ID,
            shift_id: shift.id,
            sequence: i + 1,
            kind: PeriodSlotKind.CLASS,
            starts_at: `0${8 + i}:00:00`,
            ends_at: `0${8 + i}:40:00`,
          })
        ).id,
      );
    }
    const routineId = (
      await ds.getRepository(Routine).save({
        tenant_id: SEED_TENANT_ID,
        academic_year_id: yearId,
        name: `LD ${suffix}`,
        state: RoutineState.PUBLISHED,
        published_at: new Date(),
      })
    ).id;
    slotIds = {};
    for (const weekday of [1, 2, 3]) {
      for (let p = 0; p < 5; p++) await slot(weekday, p, p === 2 ? subjectY : subjectX, routineId);
    }
    // Co-teacher on every X slot of Wed P1.
    await ds.getRepository(RoutineSlotTeacher).save({
      tenant_id: SEED_TENANT_ID,
      routine_slot_id: slotIds['3|0']!,
      teacher_id: teacherIds.co!,
    });
    planId = (
      await ds.getRepository(StudyPlan).save({
        tenant_id: SEED_TENANT_ID,
        academic_year_id: yearId,
        academic_term_id: null,
        section_id: sectionId,
        subject_id: subjectX,
        lessons: [
          { id: 'l1', title: 'L1', periods: 2 },
          { id: 'l2', title: 'L2', periods: 2 },
        ],
        exam_markers: [],
      })
    ).id;
  });

  const key = (date: string, p: number, subjectId = subjectX) => ({
    section_id: sectionId,
    subject_id: subjectId,
    date,
    period_slot_id: periods[p]!,
  });
  const rows = () =>
    ds
      .getRepository(LessonDelivery)
      .find({ where: { tenant_id: SEED_TENANT_ID, section_id: sectionId } });
  const auditOf = (id: string) =>
    ds.query(
      `SELECT * FROM audit_logs WHERE entity_type = 'LessonDelivery' AND entity_id = $1 ORDER BY created_at`,
      [id],
    );

  it('owner marks TAUGHT, then PARTLY: one row, two audit rows, recorded_at moves', async () => {
    const a = await service.put(
      { ...key(WED, 0), status: 'TAUGHT' } as never,
      SEED_TENANT_ID,
      owner,
    );
    vi.setSystemTime(new Date('2046-03-14T06:05:00Z'));
    const b = await service.put(
      { ...key(WED, 0), status: 'PARTLY' } as never,
      SEED_TENANT_ID,
      owner,
    );
    expect(b.id).toBe(a.id);
    expect(new Date(b.recorded_at).getTime()).toBeGreaterThanOrEqual(
      new Date(a.recorded_at).getTime(),
    );
    expect(await rows()).toHaveLength(1);
    const audit = await auditOf(a.id);
    expect(audit).toHaveLength(2);
    expect(audit[1].old_values.status).toBe('TAUGHT'); // the change keeps what it replaced
  });

  it('10 concurrent PUTs for one period leave exactly one row', async () => {
    const statuses = ['TAUGHT', 'PARTLY'] as const;
    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        service.put({ ...key(WED, 0), status: statuses[i % 2] } as never, SEED_TENANT_ID, owner),
      ),
    );
    const all = await rows();
    expect(all).toHaveLength(1);
    expect(statuses).toContain(all[0]!.status);
  });

  it('substitute may mark only the occurrence they cover; co-teacher ok; unrelated 403', async () => {
    await ds.getRepository(RoutineSubstitution).save({
      tenant_id: SEED_TENANT_ID,
      routine_slot_id: slotIds['3|1']!,
      date: WED,
      substitute_teacher_id: teacherIds.sub!,
      is_cancelled: false,
      created_by: sub.userId,
    });
    await expect(
      service.put({ ...key(WED, 1), status: 'TAUGHT' } as never, SEED_TENANT_ID, sub),
    ).resolves.toBeDefined();
    // Same slot, another day: no substitution there, so the substitute is a stranger.
    await expect(
      service.put({ ...key(TUE, 1), status: 'TAUGHT' } as never, SEED_TENANT_ID, sub),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      service.put({ ...key(WED, 0), status: 'TAUGHT' } as never, SEED_TENANT_ID, co),
    ).resolves.toBeDefined();
    await expect(
      service.put({ ...key(WED, 0), status: 'TAUGHT' } as never, SEED_TENANT_ID, unrelated),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('cancelled occurrence and another subject are 422 NOT_SCHEDULED', async () => {
    await ds.getRepository(RoutineSubstitution).save({
      tenant_id: SEED_TENANT_ID,
      routine_slot_id: slotIds['3|1']!,
      date: WED,
      substitute_teacher_id: null,
      is_cancelled: true,
      created_by: owner.userId,
    });
    await expect(
      service.put({ ...key(WED, 1), status: 'TAUGHT' } as never, SEED_TENANT_ID, owner),
    ).rejects.toMatchObject({ status: 422 });
    // P3 is subject Y's period, not X's.
    await expect(
      service.put({ ...key(WED, 2), status: 'TAUGHT' } as never, SEED_TENANT_ID, owner),
    ).rejects.toMatchObject({ status: 422 });
  });

  it('owner overwriting an auto row makes it human (auto=false)', async () => {
    await ds.getRepository(LessonDelivery).save({
      tenant_id: SEED_TENANT_ID,
      ...key(WED, 0),
      status: 'TAUGHT',
      auto: true,
    } as never);
    const r = await service.put(
      { ...key(WED, 0), status: 'PARTLY' } as never,
      SEED_TENANT_ID,
      owner,
    );
    expect(r.auto).toBe(false);
    expect(await rows()).toHaveLength(1);
  });

  it('today-all-taught creates only the two unmarked planned periods, and never twice', async () => {
    await ds.getRepository(LessonDelivery).save({
      tenant_id: SEED_TENANT_ID,
      ...key(WED, 0),
      status: 'PARTLY',
    } as never); // already marked
    await ds.getRepository(RoutineSubstitution).save({
      tenant_id: SEED_TENANT_ID,
      routine_slot_id: slotIds['3|1']!,
      date: WED,
      substitute_teacher_id: null,
      is_cancelled: true,
      created_by: owner.userId,
    }); // cancelled; P3 (Y) has no plan; P4 and P5 are the two unmarked
    const first = await service.markAllTaught(SEED_TENANT_ID, owner);
    expect(first.created).toBe(2);
    expect(first.skipped).toBe(3);
    const mine = await rows();
    expect(mine.find((r) => r.period_slot_id === periods[0])!.status).toBe('PARTLY'); // untouched
    const second = await service.markAllTaught(SEED_TENANT_ID, owner);
    expect(second.created).toBe(0);
  });

  it('a routine in REVIEW gives no day periods and nothing for mark-all-taught', async () => {
    await ds
      .getRepository(Routine)
      .update(
        { tenant_id: SEED_TENANT_ID, academic_year_id: yearId },
        { state: RoutineState.REVIEW },
      );
    expect((await service.day(WED, SEED_TENANT_ID, owner)).periods).toHaveLength(0);
    expect((await service.markAllTaught(SEED_TENANT_ID, owner)).created).toBe(0);
    expect(await rows()).toHaveLength(0);
  });

  it('extra: free slot ok, again 409 SLOT_TAKEN, routine slot of X 409, other subject slot ok', async () => {
    // Another section-free slot does not exist on Wed, so use TUE for the checks and make
    // a gap: remove Tue P5 occurrence by a cancellation.
    await ds.getRepository(RoutineSubstitution).save({
      tenant_id: SEED_TENANT_ID,
      routine_slot_id: slotIds['2|4']!,
      date: TUE,
      substitute_teacher_id: null,
      is_cancelled: true,
      created_by: owner.userId,
    });
    const ok = await service.extra(
      { ...key(TUE, 4), note: 'extra' } as never,
      SEED_TENANT_ID,
      owner,
    );
    expect(ok.is_extra).toBe(true);
    await expect(service.extra(key(TUE, 4) as never, SEED_TENANT_ID, owner)).rejects.toMatchObject({
      response: { details: { code: 'LESSON_DELIVERY_SLOT_TAKEN' } },
    });
    await expect(service.extra(key(TUE, 3) as never, SEED_TENANT_ID, owner)).rejects.toMatchObject({
      response: { details: { code: 'LESSON_DELIVERY_IS_ROUTINE_PERIOD' } },
    });
    // X in the slot where Y is scheduled: allowed.
    await expect(service.extra(key(TUE, 2) as never, SEED_TENANT_ID, owner)).resolves.toBeDefined();
  });

  it('GET carries lesson, number, part, recorded_at, and plan_id null for a no-plan period', async () => {
    await service.put({ ...key(WED, 0), status: 'TAUGHT' } as never, SEED_TENANT_ID, owner);
    const day = await service.day(WED, SEED_TENANT_ID, owner);
    expect(day.periods).toHaveLength(5);
    const p1 = day.periods[0]!;
    expect(p1.plan_id).toBe(planId);
    expect(p1.lesson).toMatchObject({ number: 1, title: 'L1', of: 2 });
    expect(p1.delivery!.recorded_at).toBeTruthy();
    const p3 = day.periods[2]!;
    expect(p3.plan_id).toBeNull();
    expect(p3.lesson).toBeNull();
    expect(p3.can_mark).toBe(false);
    // ADMIN has no day view.
    await expect(service.day(WED, SEED_TENANT_ID, admin)).rejects.toMatchObject({ status: 403 });
  });

  it('due counts the unmarked past periods and counts down to escalation', async () => {
    const day = await service.day(WED, SEED_TENANT_ID, owner);
    // Every earlier X period is unreported; escalate after 2 school days -> 0 left.
    expect(day.due.unreported_periods).toBeGreaterThan(0);
    expect(day.due.oldest_date).toBe('2046-01-01'); // the plan covers the whole year
    expect(day.due.school_days_until_escalation).toBe(0);
  });

  it('PUT cannot retarget another subject row, and an extra row stays TAUGHT', async () => {
    await ds.getRepository(LessonDelivery).save({
      tenant_id: SEED_TENANT_ID,
      ...key(WED, 2, subjectX),
      status: 'TAUGHT',
      is_extra: true,
    } as never);
    // Y is scheduled in P3, but the row there belongs to X: no retargeting.
    await expect(
      service.put({ ...key(WED, 2, subjectY), status: 'TAUGHT' } as never, SEED_TENANT_ID, admin),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      service.put(
        { ...key(WED, 2, subjectX), status: 'NOT_TAUGHT', reason: 'OTHER' } as never,
        SEED_TENANT_ID,
        owner,
      ),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("tenant isolation: tenant B's row for the same key never shows in tenant A's GET", async () => {
    await ds.getRepository(LessonDelivery).save({
      tenant_id: TENANT_B,
      ...key(WED, 0),
      status: 'TAUGHT',
    } as never);
    const day = await service.day(WED, SEED_TENANT_ID, owner);
    expect(day.periods[0]!.delivery).toBeNull();
    await ds.query(`DELETE FROM lesson_deliveries WHERE tenant_id = $1`, [TENANT_B]);
  });
});
