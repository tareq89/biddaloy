import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { SEED_TENANT_ID } from '@test/constants';
import {
  LeaveStatus,
  LeaveType,
  LessonDeliveryReason,
  LessonDeliveryStatus,
  PeriodSlotKind,
  RoutineState,
  SlotRecurrence,
} from '@biddaloy/shared';
import { StudyPlanAutoDeliveriesScheduler } from './study-plan-auto-deliveries.scheduler';
import { StudyPlansService } from './study-plans.service';
import { ResolveRoutineService } from '../routines/resolve-routine.service';
import { SchoolCalendarService } from '../calendar/school-calendar.service';
import { TeacherScopeService } from '../classes/teacher-scope.service';
import { AuditService } from '../audit/audit.service';
import { School } from '../schools/entities/school.entity';
import { User } from '../users/entities/user.entity';
import { StaffProfile } from '../staff-profiles/entities/staff-profile.entity';
import { LeaveRecord } from '../leave/entities/leave-record.entity';
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
 * Real-DB tests for the auto NOT_TAUGHT writer. The gate (deadline, marker) is
 * covered by the unit spec; here `writeAutoRows` is called directly. The real
 * resolver is used; the calendar is stubbed to "every date is a school day"
 * (weekday filtering still comes from the slot recurrence).
 * 2043-10-05 is a Monday, so the window is 09-28 .. 10-07 with "today" = Wed.
 */
describe('StudyPlanAutoDeliveriesScheduler (integration)', () => {
  const TENANT = SEED_TENANT_ID;
  const TENANT_B = '00000000-0000-4000-8000-000000000097';
  const MON = '2043-10-05';
  const TUE = '2043-10-06';
  const FROM = '2043-09-30';
  const TO = '2043-10-07';

  let dataSource: DataSource;
  let scheduler: StudyPlanAutoDeliveriesScheduler;
  let yearId: string;
  let sectionId: string;
  let subjectId: string;
  let routineId: string;
  let shiftId: string;
  let periodNo: number;
  let n = 0;

  beforeAll(async () => {
    const allDates = (from: string, to: string) => {
      const out: string[] = [];
      for (let d = new Date(`${from}T00:00:00Z`); d <= new Date(`${to}T00:00:00Z`);) {
        out.push(d.toISOString().slice(0, 10));
        d = new Date(d.getTime() + 86400000);
      }
      return out;
    };
    const module = await createTestModule(ALL_ENTITIES, [
      StudyPlansService,
      TeacherScopeService,
      AuditService,
      ResolveRoutineService,
      {
        provide: SchoolCalendarService,
        useValue: {
          getWorkingDays: async (i: { from: string; to: string }) => ({
            dates: allDates(i.from, i.to),
          }),
        },
      },
    ]);
    dataSource = module.get<DataSource>(getDataSourceToken());
    const schoolRepo = dataSource.getRepository(School);
    for (const id of [TENANT, TENANT_B]) {
      if (!(await schoolRepo.findOne({ where: { id } }))) {
        await schoolRepo.save({ id, name: id, slug: `school-${id.slice(-4)}` });
      }
    }
    yearId = (
      await dataSource.getRepository(AcademicYear).save({
        name: `AutoDel ${Date.now()}`,
        start_date: '2043-01-01',
        end_date: '2043-12-31',
        tenant_id: TENANT,
      })
    ).id;
    const classId = (
      await dataSource.getRepository(Class).save({
        name: 'AD 7',
        academic_year_id: yearId,
        tenant_id: TENANT,
        numeric_grade: 7,
      })
    ).id;
    sectionId = (
      await dataSource
        .getRepository(ClassSection)
        .save({ section_name: 'A', class_id: classId, tenant_id: TENANT })
    ).id;
    const repoOf = <T extends object>(e: new () => T) => dataSource.getRepository(e);
    scheduler = new StudyPlanAutoDeliveriesScheduler(
      {} as never,
      repoOf(LeaveRecord),
      repoOf(Teacher),
      repoOf(RoutineSubstitution),
      repoOf(LessonDelivery),
      {} as never,
      {} as never,
      {} as never,
      module.get(ResolveRoutineService),
      module.get(StudyPlansService),
      {} as never,
    );
  }, 60000);

  afterAll(async () => {
    if (dataSource) await dataSource.destroy();
  });

  beforeEach(async () => {
    // Fresh routine / subject / plan per test; deliveries wiped for this tenant.
    await dataSource.getRepository(LessonDelivery).delete({ tenant_id: TENANT });
    await dataSource.getRepository(Routine).delete({ tenant_id: TENANT });
    n++;
    subjectId = (
      await dataSource.getRepository(Subject).save({
        tenant_id: TENANT,
        name_en: 'Maths',
        code: `AD${n}${Math.floor(Math.random() * 1e6)}`,
      })
    ).id;
    shiftId = (
      await dataSource.getRepository(Shift).save({
        tenant_id: TENANT,
        name: `AD-Shift-${Math.random()}`,
        day_starts_at: '08:00',
        day_ends_at: '13:00',
        sequence: 0,
      })
    ).id;
    periodNo = 0;
    routineId = (
      await dataSource.getRepository(Routine).save({
        tenant_id: TENANT,
        academic_year_id: yearId,
        name: 'R',
        state: RoutineState.PUBLISHED,
      })
    ).id;
    await makePlan();
  });

  async function makePlan() {
    await dataSource.getRepository(StudyPlan).save({
      tenant_id: TENANT,
      academic_year_id: yearId,
      academic_term_id: null,
      section_id: sectionId,
      subject_id: subjectId,
    });
  }

  async function makeTeacher(tenantId = TENANT) {
    const user = await dataSource.getRepository(User).save({
      email: `ad-${Date.now()}-${Math.random()}@test.com`,
      full_name: 'AD Teacher',
    });
    const profile = await dataSource.getRepository(StaffProfile).save({
      user_id: user.id,
      tenant_id: tenantId,
      employee_id: `EMP-AD-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    });
    const teacher = await dataSource.getRepository(Teacher).save({
      user_id: user.id,
      staff_profile_id: profile.id,
      employee_id: `EMP-ADT-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      tenant_id: tenantId,
      designations: [],
    });
    return { teacherId: teacher.id, staffProfileId: profile.id };
  }

  async function leave(
    staffProfileId: string,
    start: string,
    end: string,
    status: LeaveStatus,
    tenantId = TENANT,
  ) {
    await dataSource.getRepository(LeaveRecord).save({
      tenant_id: tenantId,
      staff_profile_id: staffProfileId,
      leave_type: LeaveType.CASUAL,
      start_date: start,
      end_date: end,
      days: 1,
      status,
    });
  }

  /** One slot (new period) on `weekday`, taught by `teacherIds`. */
  async function slot(weekday: number, teacherIds: string[], tenantId = TENANT) {
    periodNo++;
    const period = await dataSource.getRepository(PeriodSlot).save({
      tenant_id: tenantId,
      shift_id: shiftId,
      sequence: periodNo,
      kind: PeriodSlotKind.CLASS,
      name: `P${periodNo}`,
      starts_at: `0${7 + periodNo}:00`,
      ends_at: `0${7 + periodNo}:45`,
    });
    const s = await dataSource.getRepository(RoutineSlot).save({
      tenant_id: tenantId,
      routine_id: routineId,
      section_id: sectionId,
      period_slot_id: period.id,
      weekday,
      subject_id: subjectId,
      recurrence: SlotRecurrence.WEEKLY,
      valid_from: '2043-01-01',
      valid_to: null,
    });
    for (const teacher_id of teacherIds) {
      await dataSource
        .getRepository(RoutineSlotTeacher)
        .save({ tenant_id: tenantId, routine_slot_id: s.id, teacher_id });
    }
    return { slotId: s.id, periodId: period.id };
  }

  const rows = () =>
    dataSource.getRepository(LessonDelivery).find({
      where: { tenant_id: TENANT },
      order: { date: 'ASC' },
    });
  const run = () => scheduler.writeAutoRows(TENANT, FROM, TO);

  it('approved leave Mon-Tue writes an ON_LEAVE auto row per planned period', async () => {
    const t = await makeTeacher();
    await slot(1, [t.teacherId]);
    await slot(2, [t.teacherId]);
    await leave(t.staffProfileId, MON, TUE, LeaveStatus.APPROVED);
    await run();
    const got = await rows();
    expect(got.map((r) => [r.date, r.status, r.reason, r.auto, r.recorded_by_user_id])).toEqual([
      [MON, LessonDeliveryStatus.NOT_TAUGHT, LessonDeliveryReason.ON_LEAVE, true, null],
      [TUE, LessonDeliveryStatus.NOT_TAUGHT, LessonDeliveryReason.ON_LEAVE, true, null],
    ]);
  });

  it('pending or rejected leave writes nothing', async () => {
    const t = await makeTeacher();
    await slot(1, [t.teacherId]);
    await leave(t.staffProfileId, MON, TUE, LeaveStatus.PENDING);
    await leave(t.staffProfileId, MON, TUE, LeaveStatus.REJECTED);
    await run();
    expect(await rows()).toHaveLength(0);
  });

  it('a substituted period gets no row (the substitute marks it)', async () => {
    const t = await makeTeacher();
    const sub = await makeTeacher();
    const a = await slot(1, [t.teacherId]);
    await slot(2, [t.teacherId]);
    const admin = await dataSource.getRepository(User).save({
      email: `ad-admin-${Date.now()}@test.com`,
      full_name: 'AD Admin',
    });
    await dataSource.getRepository(RoutineSubstitution).save({
      tenant_id: TENANT,
      routine_slot_id: a.slotId,
      date: MON,
      substitute_teacher_id: sub.teacherId,
      is_cancelled: false,
      created_by: admin.id,
    });
    await leave(t.staffProfileId, MON, TUE, LeaveStatus.APPROVED);
    await run();
    expect((await rows()).map((r) => r.date)).toEqual([TUE]);
  });

  it('co-taught slot with only one teacher on leave gets no row', async () => {
    const t = await makeTeacher();
    const other = await makeTeacher();
    await slot(1, [t.teacherId, other.teacherId]);
    await leave(t.staffProfileId, MON, TUE, LeaveStatus.APPROVED);
    await run();
    expect(await rows()).toHaveLength(0);
  });

  it('a cancellation substitution writes a CANCELLED auto row', async () => {
    const t = await makeTeacher();
    const a = await slot(1, [t.teacherId]);
    const admin = await dataSource.getRepository(User).save({
      email: `ad-admin2-${Date.now()}@test.com`,
      full_name: 'AD Admin',
    });
    await dataSource.getRepository(RoutineSubstitution).save({
      tenant_id: TENANT,
      routine_slot_id: a.slotId,
      date: MON,
      is_cancelled: true,
      created_by: admin.id,
    });
    await run();
    const got = await rows();
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ reason: LessonDeliveryReason.CANCELLED, auto: true });
  });

  it("never overwrites a person's mark", async () => {
    const t = await makeTeacher();
    const a = await slot(1, [t.teacherId]);
    await dataSource.getRepository(LessonDelivery).save({
      tenant_id: TENANT,
      section_id: sectionId,
      subject_id: subjectId,
      date: MON,
      period_slot_id: a.periodId,
      status: LessonDeliveryStatus.TAUGHT,
      auto: false,
    });
    await leave(t.staffProfileId, MON, TUE, LeaveStatus.APPROVED);
    await run();
    const got = await rows();
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ status: LessonDeliveryStatus.TAUGHT, auto: false });
  });

  it('a period with no live plan gets no row', async () => {
    await dataSource.getRepository(StudyPlan).delete({ tenant_id: TENANT, subject_id: subjectId });
    const t = await makeTeacher();
    await slot(1, [t.teacherId]);
    await leave(t.staffProfileId, MON, TUE, LeaveStatus.APPROVED);
    await run();
    expect(await rows()).toHaveLength(0);
  });

  it('a second run adds no rows and does not throw', async () => {
    const t = await makeTeacher();
    await slot(1, [t.teacherId]);
    await leave(t.staffProfileId, MON, TUE, LeaveStatus.APPROVED);
    await run();
    await run();
    expect(await rows()).toHaveLength(1);
  });

  it('leave outside the 8-day window writes nothing', async () => {
    const t = await makeTeacher();
    await slot(1, [t.teacherId]);
    await leave(t.staffProfileId, '2043-09-28', '2043-09-28', LeaveStatus.APPROVED); // 9 days before TO
    await run();
    expect(await rows()).toHaveLength(0);
  });

  it("another tenant's leave never writes rows in this tenant", async () => {
    const b = await makeTeacher(TENANT_B);
    // Tenant A has a planned slot taught by someone else; B's leave must not touch it.
    const a = await makeTeacher();
    await slot(1, [a.teacherId]);
    await leave(b.staffProfileId, MON, TUE, LeaveStatus.APPROVED, TENANT_B);
    await run();
    expect(await rows()).toHaveLength(0);
  });
});
