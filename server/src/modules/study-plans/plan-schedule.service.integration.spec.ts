import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from 'vitest';
import { ConfigModule } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { SEED_TENANT_ID, SEED_ADMIN_USER_ID } from '@test/constants';
import { PeriodSlotKind, RoutineState, SlotRecurrence } from '@biddaloy/shared';
import { PlanScheduleService } from './plan-schedule.service';
import { StudyPlansService } from './study-plans.service';
import { TeacherScopeService } from '../classes/teacher-scope.service';
import { AuditService } from '../audit/audit.service';
import { ResolveRoutineService } from '../routines/resolve-routine.service';
import { SchoolsService } from '../schools/schools.service';
import { CalendarModule } from '../calendar/calendar.module';
import { AuthModule } from '../auth/auth.module';
import { School } from '../schools/entities/school.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { AcademicTerm } from '../calendar/entities/academic-term.entity';
import { Class } from '../academics/entities/class.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { Subject } from '../academics/entities/subject.entity';
import { CalendarEvent } from '../calendar/entities/calendar-event.entity';
import { CalendarEventClass } from '../calendar/entities/calendar-event-class.entity';
import { Shift } from '../routines/entities/shift.entity';
import { PeriodSlot } from '../routines/entities/period-slot.entity';
import { Routine } from '../routines/entities/routine.entity';
import { RoutineSlot } from '../routines/entities/routine-slot.entity';
import { RoutineSubstitution } from '../routines/entities/routine-substitution.entity';
import { StudyPlan } from './entities/study-plan.entity';
import { LessonDelivery } from './entities/lesson-delivery.entity';

/**
 * [66.2.02/#2007] Real DB, real resolver and calendar. Math runs Mon/Tue/Wed
 * (weekday 1..3) for section 9-A in March 2045 (2045-03-06 is a Monday).
 * Worked example: L1 (2 periods), L2 (1), L3 (1); today is Wed 2045-03-15.
 */
describe('PlanScheduleService (integration)', () => {
  let ds: DataSource;
  let service: PlanScheduleService;
  let resolver: ResolveRoutineService;
  const TENANT_B = '00000000-0000-4000-8000-0000000066c7';
  let timezone = 'Asia/Dhaka';

  let yearId: string;
  let termId: string;
  let classId: string;
  let sectionId: string;
  let subjectId: string;
  let otherSubjectId: string;
  let periodId: string;
  let routineId: string;
  let slotIds: string[]; // Mon, Tue, Wed
  let suffix: string;

  beforeAll(async () => {
    const module = await createTestModule(
      ALL_ENTITIES,
      [
        PlanScheduleService,
        ResolveRoutineService,
        StudyPlansService,
        TeacherScopeService,
        AuditService,
        {
          provide: SchoolsService,
          useValue: { getResolvedSettings: async () => ({ region: { timezone } }) },
        },
      ],
      [ConfigModule.forRoot({ isGlobal: true }), CalendarModule, AuthModule],
    );
    ds = module.get<DataSource>(getDataSourceToken());
    service = module.get(PlanScheduleService);
    resolver = module.get(ResolveRoutineService);
    if (!(await ds.getRepository(School).findOne({ where: { id: TENANT_B } }))) {
      await ds.getRepository(School).save({ id: TENANT_B, name: 'PS Other', slug: 'ps-other-67' });
    }
    const where = { tenant_id: SEED_TENANT_ID, name: 'PS Schedule 2045' };
    yearId = (
      (await ds.getRepository(AcademicYear).findOne({ where })) ??
      (await ds.getRepository(AcademicYear).save({
        ...where,
        start_date: '2045-01-01',
        end_date: '2045-12-31',
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

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2045-03-15T06:00:00Z')); // Wed noon in Dhaka
    await ds.query('DELETE FROM calendar_events');
    await ds
      .getRepository(School)
      .update(
        { id: SEED_TENANT_ID },
        { settings: { version: 1, attendance: { weeklyOffDays: [] } } as never },
      );
    termId = (
      await ds.getRepository(AcademicTerm).save({
        tenant_id: SEED_TENANT_ID,
        academic_year_id: yearId,
        name: 'PS March',
        seq: 1,
        start_date: '2045-03-06',
        end_date: '2045-03-31',
      })
    ).id;
    suffix = Math.random().toString(36).slice(2, 8);
    const c = await ds
      .getRepository(Class)
      .save({ name: `Nine ${suffix}`, academic_year_id: yearId, tenant_id: SEED_TENANT_ID });
    classId = c.id;
    sectionId = (
      await ds
        .getRepository(ClassSection)
        .save({ class_id: c.id, section_name: 'A', tenant_id: SEED_TENANT_ID })
    ).id;
    const subj = (code: string) =>
      ds.getRepository(Subject).save({
        tenant_id: SEED_TENANT_ID,
        code: `${code}${suffix}`,
        name_en: `${code} ${suffix}`,
        name_bn: 'বি',
      });
    subjectId = (await subj('M')).id;
    otherSubjectId = (await subj('E')).id;
    const shift = await ds.getRepository(Shift).save({
      tenant_id: SEED_TENANT_ID,
      name: `PS-${suffix}`,
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
    await makeRoutine(RoutineState.PUBLISHED);
  });

  async function makeRoutine(state: RoutineState) {
    routineId = (
      await ds.getRepository(Routine).save({
        tenant_id: SEED_TENANT_ID,
        academic_year_id: yearId,
        name: `PS ${suffix}`,
        state,
        published_at: state === RoutineState.PUBLISHED ? new Date() : null,
      })
    ).id;
    slotIds = [];
    for (const weekday of [1, 2, 3]) {
      slotIds.push(
        (
          await ds.getRepository(RoutineSlot).save({
            tenant_id: SEED_TENANT_ID,
            routine_id: routineId,
            section_id: sectionId,
            period_slot_id: periodId,
            weekday,
            subject_id: subjectId,
            recurrence: SlotRecurrence.WEEKLY,
            recurrence_offset: 0,
            valid_from: '2045-01-01',
            valid_to: null,
          })
        ).id,
      );
    }
  }

  async function makePlan(
    term: string | null,
    lessons: [string, number][],
    tenant = SEED_TENANT_ID,
  ) {
    return ds.getRepository(StudyPlan).save({
      tenant_id: tenant,
      academic_year_id: yearId,
      academic_term_id: term,
      section_id: sectionId,
      subject_id: subjectId,
      lessons: lessons.map(([id, periods]) => ({ id, title: id, periods })),
      exam_markers: [],
    });
  }

  async function deliver(
    date: string,
    status: 'TAUGHT' | 'PARTLY' | 'NOT_TAUGHT',
    over: Partial<LessonDelivery> = {},
  ): Promise<LessonDelivery> {
    return (await ds.getRepository(LessonDelivery).save({
      tenant_id: SEED_TENANT_ID,
      section_id: sectionId,
      subject_id: subjectId,
      date,
      period_slot_id: periodId,
      status,
      reason: status === 'NOT_TAUGHT' ? 'TEACHER_ABSENT' : null,
      ...over,
    } as never)) as unknown as LessonDelivery;
  }

  async function workedExample() {
    // Wed 03-08 is a class-only holiday: the resolver omits it.
    const event = await ds.getRepository(CalendarEvent).save({
      tenant_id: SEED_TENANT_ID,
      academic_year_id: yearId,
      start_date: '2045-03-08',
      end_date: '2045-03-08',
      name: 'Class break',
      counts_as_working_day: false,
      published_at: new Date(),
    });
    await ds
      .getRepository(CalendarEventClass)
      .save({ event_id: event.id, class_id: classId, tenant_id: SEED_TENANT_ID });
    // Tue 03-21 is cancelled by a substitution.
    await ds.getRepository(RoutineSubstitution).save({
      tenant_id: SEED_TENANT_ID,
      routine_slot_id: slotIds[1],
      date: '2045-03-21',
      substitute_teacher_id: null,
      is_cancelled: true,
      created_by: SEED_ADMIN_USER_ID,
    } as never);
    await deliver('2045-03-06', 'TAUGHT');
    await deliver('2045-03-07', 'PARTLY');
    await deliver('2045-03-13', 'NOT_TAUGHT');
    return makePlan(termId, [
      ['L1', 2],
      ['L2', 1],
      ['L3', 1],
    ]);
  }

  it('worked example: 3 periods behind, expected dates skip the holiday and the cancellation', async () => {
    const plan = await workedExample();
    const res = await service.scheduleFor(plan, SEED_TENANT_ID);
    expect(res.today).toBe('2045-03-15');
    expect(res.range).toEqual({ from: '2045-03-06', to: '2045-03-31' });
    expect(res.summary).toMatchObject({
      periods_behind: 3,
      lessons_done: 0,
      lessons_total: 3,
      unreported_periods: 1,
      unreported_school_days: 1,
      oldest_unreported_date: '2045-03-14',
      routine_missing: false,
    });
    const by = (id: string) => res.lessons.find((l) => l.id === id)!;
    expect(by('L1').expected_end_date).toBe('2045-03-15'); // today's period
    expect(by('L2').expected_date).toBe('2045-03-20');
    expect(by('L3').expected_date).toBe('2045-03-22'); // Tue 21 cancelled
    expect(res.periods.find((p) => p.date === '2045-03-08')).toBeUndefined();
    expect(res.periods.find((p) => p.date === '2045-03-21')?.status).toBe('EXCLUDED');
  });

  it('Dhaka midnight: Tuesday is FUTURE at 23:59 Dhaka, UNREPORTED at 00:01 Wednesday', async () => {
    const plan = await makePlan(termId, [['L1', 1]]);
    const statusOn = async () =>
      (await service.scheduleFor(plan, SEED_TENANT_ID)).periods.find((p) => p.date === '2045-03-14')
        ?.status;
    vi.setSystemTime(new Date('2045-03-14T17:59:00Z'));
    expect(await statusOn()).toBe('FUTURE');
    vi.setSystemTime(new Date('2045-03-14T18:01:00Z'));
    expect(await statusOn()).toBe('UNREPORTED');
  });

  it('whole-year plan uses the year dates', async () => {
    const year = await service.scheduleFor(await makePlan(null, [['L1', 1]]), SEED_TENANT_ID);
    expect(year.range).toEqual({ from: '2045-01-01', to: '2045-12-31' });
  });

  it('a term plan stops at the term end', async () => {
    const res = await service.scheduleFor(await makePlan(termId, [['L1', 1]]), SEED_TENANT_ID);
    expect(res.periods.every((p) => p.date <= '2045-03-31')).toBe(true);
    expect(res.periods.length).toBeGreaterThan(0);
  });

  it('DRAFT routine gives routine_missing and no periods', async () => {
    await ds.query('DELETE FROM routine_slots WHERE routine_id = $1', [routineId]);
    await ds.query('DELETE FROM routines WHERE id = $1', [routineId]);
    await makeRoutine(RoutineState.DRAFT);
    const res = await service.scheduleFor(await makePlan(termId, [['L1', 1]]), SEED_TENANT_ID);
    expect(res.periods).toEqual([]);
    expect(res.summary.routine_missing).toBe(true);
    expect(res.lessons[0].expected_date).toBeNull();
  });

  it('summarize gives a zeroed routine_missing summary when the plan term is gone', async () => {
    const plan = await makePlan(termId, [['L1', 1]]);
    await ds.query('DELETE FROM academic_terms WHERE id = $1', [termId]).catch(() => undefined);
    // FK from the plan may block the delete; point the plan at a missing term object instead.
    const out = await service.summarize(
      [{ ...plan, academic_term_id: crypto.randomUUID() }],
      SEED_TENANT_ID,
    );
    expect(out.get(plan.id)).toMatchObject({
      lessons_total: 1,
      periods_behind: 0,
      routine_missing: true,
    });
  });

  it('routine_missing is true when a PUBLISHED routine yields no occurrences for the section', async () => {
    await ds.query('DELETE FROM routine_slots WHERE routine_id = $1', [routineId]);
    const res = await service.scheduleFor(await makePlan(termId, [['L1', 1]]), SEED_TENANT_ID);
    expect(res.summary.routine_missing).toBe(true);
  });

  it('capacity: a term of another year is a 400', async () => {
    const other = await ds.getRepository(AcademicYear).save({
      tenant_id: SEED_TENANT_ID,
      name: `PS Other ${suffix}`,
      start_date: '2046-01-01',
      end_date: '2046-12-31',
      is_current: false,
    });
    const t = await ds.getRepository(AcademicTerm).save({
      tenant_id: SEED_TENANT_ID,
      academic_year_id: other.id,
      name: 'PS T',
      seq: 1,
      start_date: '2046-01-01',
      end_date: '2046-02-01',
    });
    await expect(
      service.capacityFor(SEED_TENANT_ID, sectionId, subjectId, t.id),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('summarize over two plans of one section calls the resolver once', async () => {
    const a = await makePlan(termId, [['L1', 1]]);
    const b = await ds.getRepository(StudyPlan).save({
      tenant_id: SEED_TENANT_ID,
      academic_year_id: yearId,
      academic_term_id: termId,
      section_id: sectionId,
      subject_id: otherSubjectId,
      lessons: [],
      exam_markers: [],
    });
    const spy = vi.spyOn(resolver, 'resolveRoutine');
    const out = await service.summarize([a, b], SEED_TENANT_ID);
    expect(spy).toHaveBeenCalledTimes(1);
    expect([...out.keys()].sort()).toEqual([a.id, b.id].sort());
    spy.mockRestore();
  });

  it('last_reported_at (D44): newest human row; auto rows, other subjects and other tenants do not count', async () => {
    const plan = await makePlan(termId, [['L1', 1]]);
    const none = await service.summarize([plan], SEED_TENANT_ID);
    expect(none.get(plan.id)!.last_reported_at).toBeNull();

    const human = await deliver('2045-03-06', 'TAUGHT', { auto: false });
    // A later auto row, a later row of another subject: neither moves it.
    await deliver('2045-03-07', 'NOT_TAUGHT', { auto: true, reason: 'ON_LEAVE' });
    await ds.query(
      `UPDATE lesson_deliveries SET updated_at = NOW() + interval '1 hour' WHERE auto`,
    );
    await deliver('2045-03-13', 'TAUGHT', { subject_id: otherSubjectId, auto: false });
    await ds.query(
      `UPDATE lesson_deliveries SET updated_at = NOW() + interval '2 hour' WHERE subject_id = $1`,
      [otherSubjectId],
    );
    const res = await service.summarize([plan], SEED_TENANT_ID);
    const humanRow = await ds.getRepository(LessonDelivery).findOneByOrFail({ id: human.id });
    expect(res.get(plan.id)!.last_reported_at).toBe(humanRow.updated_at.toISOString());
  });

  it("another tenant's deliveries for the same section never count", async () => {
    const plan = await makePlan(termId, [['L1', 1]]);
    // Raw insert: tenant B row naming tenant A's section/subject/period ids.
    await ds.query(
      `INSERT INTO lesson_deliveries (id, tenant_id, section_id, subject_id, date, period_slot_id, status, is_extra, auto, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, '2045-03-06', $4, 'TAUGHT', false, false, NOW(), NOW())`,
      [TENANT_B, sectionId, subjectId, periodId],
    );
    const res = await service.scheduleFor(plan, SEED_TENANT_ID);
    expect(res.periods.find((p) => p.date === '2045-03-06')?.status).toBe('UNREPORTED');
    expect(res.summary.last_reported_at).toBeNull();
  });
});
