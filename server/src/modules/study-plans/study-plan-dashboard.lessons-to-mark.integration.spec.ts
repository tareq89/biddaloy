import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from 'vitest';
import { ConfigModule } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { SEED_TENANT_ID } from '@test/constants';
import { PeriodSlotKind, RoutineState, SlotRecurrence, UserRole } from '@biddaloy/shared';
import { StudyPlanDashboardService } from './study-plan-dashboard.service';
import { LessonDeliveriesService } from './lesson-deliveries.service';
import { PlanScheduleService } from './plan-schedule.service';
import { StudyPlansService } from './study-plans.service';
import { TeacherScopeService } from '../classes/teacher-scope.service';
import { AuditService } from '../audit/audit.service';
import { ResolveRoutineService } from '../routines/resolve-routine.service';
import { DEFAULT_ATTENDANCE_SETTINGS } from '../schools/settings/tenant-settings-defaults';
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
 * [8.10.7.7.05] `lessonsToMark` against a real DB, resolver and schedule.
 * Year 2047; Mon/Tue/Wed periods. "Now" is Wed 2047-03-13 noon in Dhaka.
 * The plan was made on Mon 03-04, so the periods owed are Mon 04, Tue 05,
 * Wed 06, Mon 11, Tue 12 (past) - 04 and 05 are marked, so 3 are unmarked.
 */
describe('StudyPlanDashboardService.lessonsToMark (integration)', () => {
  let ds: DataSource;
  let service: StudyPlanDashboardService;
  let deliveries: LessonDeliveriesService;
  const OTHER_TENANT = '00000000-0000-4000-8000-000001931001';
  let timezone = 'Asia/Dhaka';

  let yearId: string;
  let sectionA: string;
  let sectionB: string;
  let subjectId: string;
  let periodId: string;
  let me: { userId: string; teacherId: string };
  let other: { userId: string; teacherId: string };
  let cover: { userId: string; teacherId: string };
  let slotsA: string[]; // Mon, Tue, Wed of section A (teacher: me)

  beforeAll(async () => {
    const module = await createTestModule(
      ALL_ENTITIES,
      [
        StudyPlanDashboardService,
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
              region: { timezone },
              attendance: DEFAULT_ATTENDANCE_SETTINGS,
              studyPlans: { escalateAfterSchoolDays: 2 },
            }),
          },
        },
      ],
      [ConfigModule.forRoot({ isGlobal: true }), CalendarModule, AuthModule],
    );
    ds = module.get<DataSource>(getDataSourceToken());
    service = module.get(StudyPlanDashboardService);
    deliveries = module.get(LessonDeliveriesService);
    if (!(await ds.getRepository(School).findOne({ where: { id: OTHER_TENANT } }))) {
      await ds
        .getRepository(School)
        .save({ id: OTHER_TENANT, name: 'LTM Other', slug: 'ltm-other' });
    }
    const where = { tenant_id: SEED_TENANT_ID, name: 'LTM Lessons 2047' };
    yearId = (
      (await ds.getRepository(AcademicYear).findOne({ where })) ??
      (await ds.getRepository(AcademicYear).save({
        ...where,
        start_date: '2047-01-01',
        end_date: '2047-12-31',
        is_current: false,
      }))
    ).id;
  }, 60000);

  afterAll(async () => {
    await ds.destroy();
  });

  afterEach(() => {
    vi.useRealTimers();
    timezone = 'Asia/Dhaka';
  });

  async function makeTeacher(tag: string) {
    const user = await ds.getRepository(User).save({
      email: `ltm-${tag}-${Date.now()}-${Math.random()}@test.com`,
      full_name: `LTM ${tag}`,
    });
    const t = await ds.getRepository(Teacher).save({
      user_id: user.id,
      employee_id: `EMP-LTM-${tag}-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
      tenant_id: SEED_TENANT_ID,
      designations: [],
    });
    return { userId: user.id, teacherId: t.id };
  }

  async function section(classId: string, name: string) {
    return (
      await ds
        .getRepository(ClassSection)
        .save({ class_id: classId, section_name: name, tenant_id: SEED_TENANT_ID })
    ).id;
  }

  /** Mon/Tue/Wed slots of one section, all taught by `teacherId`; plus its plan. */
  async function routineFor(routineId: string, sectionId: string, teacherId: string) {
    const ids: string[] = [];
    for (const weekday of [1, 2, 3]) {
      const s = await ds.getRepository(RoutineSlot).save({
        tenant_id: SEED_TENANT_ID,
        routine_id: routineId,
        section_id: sectionId,
        period_slot_id: periodId,
        weekday,
        subject_id: subjectId,
        recurrence: SlotRecurrence.WEEKLY,
        recurrence_offset: 0,
        valid_from: '2047-01-01',
        valid_to: null,
      });
      await ds
        .getRepository(RoutineSlotTeacher)
        .save({ tenant_id: SEED_TENANT_ID, routine_slot_id: s.id, teacher_id: teacherId });
      ids.push(s.id);
    }
    const plan = await ds.getRepository(StudyPlan).save({
      tenant_id: SEED_TENANT_ID,
      academic_year_id: yearId,
      academic_term_id: null,
      section_id: sectionId,
      subject_id: subjectId,
      lessons: [
        { id: 'L1', title: 'Chapter 1', periods: 4 },
        { id: 'L2', title: 'Chapter 2', periods: 4 },
      ],
      exam_markers: [],
    });
    // The plan owes periods from its creation day (D1 floor): back-date it.
    await ds.query(`UPDATE study_plans SET created_at = $2 WHERE id = $1`, [
      plan.id,
      '2047-03-04T06:00:00Z',
    ]);
    return ids;
  }

  const taught = (sectionId: string, date: string) =>
    ds.getRepository(LessonDelivery).save({
      tenant_id: SEED_TENANT_ID,
      section_id: sectionId,
      subject_id: subjectId,
      date,
      period_slot_id: periodId,
      status: 'TAUGHT',
      reason: null,
    } as never);

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2047-03-13T06:00:00Z')); // Wed noon in Dhaka
    await ds.query('DELETE FROM calendar_events');
    await ds
      .getRepository(School)
      .update(
        { id: SEED_TENANT_ID },
        { settings: { version: 1, attendance: { weeklyOffDays: [] } } as never },
      );
    const tag = Math.random().toString(36).slice(2, 8);
    const c = await ds
      .getRepository(Class)
      .save({ name: `Ten ${tag}`, academic_year_id: yearId, tenant_id: SEED_TENANT_ID });
    sectionA = await section(c.id, 'A');
    sectionB = await section(c.id, 'B');
    subjectId = (
      await ds.getRepository(Subject).save({
        tenant_id: SEED_TENANT_ID,
        code: `LM${tag}`,
        name_en: `Math ${tag}`,
        name_bn: 'গণিত',
      })
    ).id;
    const shift = await ds.getRepository(Shift).save({
      tenant_id: SEED_TENANT_ID,
      name: `LTM-${tag}`,
      day_starts_at: '08:00:00',
      day_ends_at: '14:00:00',
      sequence: 0,
    });
    periodId = (
      await ds.getRepository(PeriodSlot).save({
        tenant_id: SEED_TENANT_ID,
        shift_id: shift.id,
        sequence: 0,
        kind: PeriodSlotKind.CLASS,
        starts_at: '08:00:00',
        ends_at: '08:40:00',
      })
    ).id;
    [me, other, cover] = [
      await makeTeacher('me'),
      await makeTeacher('other'),
      await makeTeacher('cover'),
    ];
    const routineId = (
      await ds.getRepository(Routine).save({
        tenant_id: SEED_TENANT_ID,
        academic_year_id: yearId,
        name: `LTM ${tag}`,
        state: RoutineState.PUBLISHED,
        published_at: new Date(),
      })
    ).id;
    slotsA = await routineFor(routineId, sectionA, me.teacherId);
    await routineFor(routineId, sectionB, other.teacherId);
    // Marked: Mon 03-04 and Tue 03-05 of both sections. Future periods are not owed.
    for (const s of [sectionA, sectionB]) {
      await taught(s, '2047-03-04');
      await taught(s, '2047-03-05');
    }
  });

  it('3 past unmarked (+2 marked, + today and future ignored) -> to_mark 3, newest first', async () => {
    const out = await service.lessonsToMark(SEED_TENANT_ID, me.userId);
    expect(out.to_mark).toBe(3);
    expect(out.oldest_planned_on).toBe('2047-03-06');
    expect(out.items.map((i) => i.planned_on)).toEqual(['2047-03-12', '2047-03-11', '2047-03-06']);
    expect(out.items[0]).toMatchObject({ section_name: 'A', subject_name_bn: 'গণিত' });
    expect(out.items.every((i) => i.section_name === 'A')).toBe(true);
  });

  it("another teacher's lessons are never counted", async () => {
    const mine = await service.lessonsToMark(SEED_TENANT_ID, me.userId);
    const theirs = await service.lessonsToMark(SEED_TENANT_ID, other.userId);
    expect(theirs.to_mark).toBe(3);
    expect(theirs.items.every((i) => i.section_name === 'B')).toBe(true);
    expect(mine.items.some((i) => i.section_name === 'B')).toBe(false);
  });

  it('a user without a teacher profile gets zero', async () => {
    const u = await ds
      .getRepository(User)
      .save({ email: `ltm-none-${Date.now()}@test.com`, full_name: 'N' });
    expect(await service.lessonsToMark(SEED_TENANT_ID, u.id)).toEqual({
      to_mark: 0,
      oldest_planned_on: null,
      items: [],
    });
  });

  it('a substitute counts the period they cover; the owner no longer owes it', async () => {
    // Mon 03-11 of section A is covered by `cover`.
    await ds.getRepository(RoutineSubstitution).save({
      tenant_id: SEED_TENANT_ID,
      routine_slot_id: slotsA[0],
      date: '2047-03-11',
      substitute_teacher_id: cover.teacherId,
      is_cancelled: false,
      created_by: me.userId,
    } as never);
    const owner = await service.lessonsToMark(SEED_TENANT_ID, me.userId);
    const sub = await service.lessonsToMark(SEED_TENANT_ID, cover.userId);
    expect(owner.items.map((i) => i.planned_on)).toEqual(['2047-03-12', '2047-03-06']);
    expect(sub.items.map((i) => i.planned_on)).toEqual(['2047-03-11']);
  });

  it('tenant isolation: the same user in another tenant sees nothing', async () => {
    expect((await service.lessonsToMark(OTHER_TENANT, me.userId)).to_mark).toBe(0);
  });

  it('"today" is school-local: just before Dhaka midnight Tue 03-12 is already due, in UTC it is not yet', async () => {
    vi.setSystemTime(new Date('2047-03-12T18:00:00Z')); // Dhaka: Wed 03-13 00:00
    expect((await service.lessonsToMark(SEED_TENANT_ID, me.userId)).to_mark).toBe(3);
    timezone = 'UTC'; // UTC: still Tue 03-12, so that day is not past yet
    expect((await service.lessonsToMark(SEED_TENANT_ID, me.userId)).to_mark).toBe(2);
  });

  it('expectedForTeacher: pace for a planned pair, nothing for a pair without a plan', async () => {
    const stray = await section(
      (await ds.getRepository(ClassSection).findOneByOrFail({ id: sectionA })).class_id,
      'Z',
    );
    const out = await service.expectedForTeacher(SEED_TENANT_ID, [
      { section_id: sectionA, subject_id: subjectId },
      { section_id: stray, subject_id: subjectId },
    ]);
    expect([...out.keys()]).toEqual([`${sectionA}|${subjectId}`]);
    expect(out.get(`${sectionA}|${subjectId}`)!.total).toBe(2);
    expect(await service.expectedForTeacher(SEED_TENANT_ID, [])).toEqual(new Map());
  });

  it('reconciles with the day view: to_mark equals due.unreported_periods', async () => {
    const out = await service.lessonsToMark(SEED_TENANT_ID, me.userId);
    const day = await deliveries.day('2047-03-13', SEED_TENANT_ID, {
      userId: me.userId,
      tenantId: SEED_TENANT_ID,
      role: UserRole.TEACHER,
    });
    expect(day.due.unreported_periods).toBe(out.to_mark);
    expect(day.due.oldest_date).toBe(out.oldest_planned_on);
  });
});
