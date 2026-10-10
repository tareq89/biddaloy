import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from 'vitest';
import { ConfigModule } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { SEED_TENANT_ID, SEED_ADMIN_USER_ID } from '@test/constants';
import {
  EnrollmentStatus,
  PeriodSlotKind,
  RoutineState,
  SlotRecurrence,
  UserRole,
  UserStatus,
} from '@biddaloy/shared';
import { StudyPlanFlagsScheduler } from './study-plan-flags.scheduler';
import { PlanScheduleService } from './plan-schedule.service';
import { StudyPlansService } from './study-plans.service';
import { TeacherScopeService } from '../classes/teacher-scope.service';
import { AuditService } from '../audit/audit.service';
import { ResolveRoutineService } from '../routines/resolve-routine.service';
import { SchoolsService } from '../schools/schools.service';
import { SchoolCalendarService } from '../calendar/school-calendar.service';
import { CalendarModule } from '../calendar/calendar.module';
import { AuthModule } from '../auth/auth.module';
import { School } from '../schools/entities/school.entity';
import { User } from '../users/entities/user.entity';
import { UserTenant } from '../auth/entities/user-tenant.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { Class } from '../academics/entities/class.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { Subject } from '../academics/entities/subject.entity';
import { Teacher } from '../academics/entities/teacher.entity';
import { Student } from '../students/entities/student.entity';
import { Guardian } from '../students/entities/guardian.entity';
import { Shift } from '../routines/entities/shift.entity';
import { PeriodSlot } from '../routines/entities/period-slot.entity';
import { Routine } from '../routines/entities/routine.entity';
import { RoutineSlot } from '../routines/entities/routine-slot.entity';
import { RoutineSlotTeacher } from '../routines/entities/routine-slot-teacher.entity';
import { RoutineSubstitution } from '../routines/entities/routine-substitution.entity';
import { StudyPlan } from './entities/study-plan.entity';
import { LessonDelivery } from './entities/lesson-delivery.entity';

/**
 * [66.2.05/#2010] Real DB, real resolver and calendar; push and Redis stubbed.
 * Year 2047. Routine Mon/Tue/Wed (weekday 1..3), one period, subject X (planned)
 * and subject Y (never planned). "Now" is Wed 2047-03-13 noon Dhaka, so
 * "yesterday" is Tue 03-12 and Mon 03-11 is two working days back.
 */
describe('StudyPlanFlagsScheduler (integration)', () => {
  let ds: DataSource;
  let scheduler: StudyPlanFlagsScheduler;
  const TENANT_B = '00000000-0000-4000-8000-0000000066c9';
  const MON = '2047-03-11';
  const TUE = '2047-03-12';
  const SETTINGS = {
    statusDeadline: '18:00',
    reminderTime: '08:00',
    escalateAfterSchoolDays: 2,
    weeklyDigestTime: '17:00',
    guardianDigestSms: false,
  };

  let pushed: { userId: string; tenantId: string; body: string; type: string }[];
  let yearId: string;
  let sectionId: string;
  let otherSectionId: string;
  let subjectX: string;
  let periodId: string;
  let routineId: string;
  let tueSlotId: string;
  let owner: { userId: string; teacherId: string; name: string };
  let substitute: { userId: string; teacherId: string; name: string };
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
          useValue: {
            getResolvedSettings: async () => ({
              region: { timezone: 'Asia/Dhaka' },
              attendance: { weeklyOffDays: [] },
            }),
          },
        },
      ],
      [ConfigModule.forRoot({ isGlobal: true }), CalendarModule, AuthModule],
    );
    ds = module.get<DataSource>(getDataSourceToken());
    if (!(await ds.getRepository(School).findOne({ where: { id: TENANT_B } }))) {
      await ds.getRepository(School).save({ id: TENANT_B, name: 'SF Other', slug: 'sf-other-69' });
    }
    const where = { tenant_id: SEED_TENANT_ID, name: 'SF Flags 2047' };
    yearId = (
      (await ds.getRepository(AcademicYear).findOne({ where })) ??
      (await ds.getRepository(AcademicYear).save({
        ...where,
        start_date: '2047-01-01',
        end_date: '2047-12-31',
        is_current: false,
      }))
    ).id;

    const push = {
      sendToUser: async (userId: string, tenantId: string, p: { body: string; type: string }) => {
        pushed.push({ userId, tenantId, body: p.body, type: p.type });
      },
    };
    scheduler = new StudyPlanFlagsScheduler(
      {} as never,
      ds.getRepository(StudyPlan),
      ds.getRepository(Student),
      ds.getRepository(UserTenant),
      // The 2047 test year is not the seed's "current" one; hand it over directly.
      { findOne: async () => ({ id: yearId }) } as never,
      {} as never,
      module.get(SchoolsService),
      {} as never,
      module.get(SchoolCalendarService),
      module.get(PlanScheduleService),
      module.get(StudyPlansService),
      push as never,
      {} as never,
      {} as never,
    );
  }, 60000);

  afterAll(async () => {
    await ds.destroy();
  });

  afterEach(() => vi.useRealTimers());

  async function makeUser(tag: string, extra: Partial<User> = {}) {
    return ds.getRepository(User).save({
      email: `sf-${tag}-${Date.now()}-${Math.random()}@test.com`,
      full_name: `SF ${tag} ${suffix}`,
      ...extra,
    });
  }

  async function makeTeacher(tag: string) {
    const user = await makeUser(tag);
    const t = await ds.getRepository(Teacher).save({
      user_id: user.id,
      employee_id: `EMP-SF-${tag}-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
      tenant_id: SEED_TENANT_ID,
      designations: [],
    });
    return { userId: user.id, teacherId: t.id, name: user.full_name };
  }

  async function member(tag: string, role: UserRole, tenant = SEED_TENANT_ID, status?: UserStatus) {
    const user = await makeUser(tag, status ? { status } : {});
    await ds.getRepository(UserTenant).save({ user_id: user.id, tenant_id: tenant, role });
    return user.id;
  }

  async function deliver(date: string, over: Partial<LessonDelivery>) {
    await ds.getRepository(LessonDelivery).save({
      tenant_id: SEED_TENANT_ID,
      section_id: sectionId,
      subject_id: subjectX,
      date,
      period_slot_id: periodId,
      ...over,
    } as never);
  }

  beforeEach(async () => {
    pushed = [];
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2047-03-13T06:00:00Z')); // Wed noon Dhaka
    await ds.query('DELETE FROM calendar_events');
    await ds.query('DELETE FROM study_plans WHERE academic_year_id = $1', [yearId]);
    await ds.query("DELETE FROM lesson_deliveries WHERE date >= '2047-01-01'");
    suffix = Math.random().toString(36).slice(2, 8);
    const c = await ds
      .getRepository(Class)
      .save({ name: `Eleven ${suffix}`, academic_year_id: yearId, tenant_id: SEED_TENANT_ID });
    const section = (name: string) =>
      ds
        .getRepository(ClassSection)
        .save({ class_id: c.id, section_name: name, tenant_id: SEED_TENANT_ID })
        .then((s) => s.id);
    sectionId = await section('A');
    otherSectionId = await section('B'); // no plan at all
    const subj = (code: string) =>
      ds
        .getRepository(Subject)
        .save({
          tenant_id: SEED_TENANT_ID,
          code: `${code}${suffix}`,
          name_en: `${code} ${suffix}`,
          name_bn: `বিষয়${code}`,
        })
        .then((s) => s.id);
    subjectX = await subj('X');
    const subjectY = await subj('Y');
    const shift = await ds.getRepository(Shift).save({
      tenant_id: SEED_TENANT_ID,
      name: `SF-${suffix}`,
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
    owner = await makeTeacher('owner');
    substitute = await makeTeacher('sub');
    routineId = (
      await ds.getRepository(Routine).save({
        tenant_id: SEED_TENANT_ID,
        academic_year_id: yearId,
        name: `SF ${suffix}`,
        state: RoutineState.PUBLISHED,
        published_at: new Date(),
      })
    ).id;
    for (const weekday of [1, 2, 3]) {
      const slot = await ds.getRepository(RoutineSlot).save({
        tenant_id: SEED_TENANT_ID,
        routine_id: routineId,
        section_id: sectionId,
        period_slot_id: periodId,
        weekday,
        subject_id: subjectX,
        recurrence: SlotRecurrence.WEEKLY,
        recurrence_offset: 0,
        valid_from: '2047-01-01',
        valid_to: null,
      });
      await ds
        .getRepository(RoutineSlotTeacher)
        .save({ tenant_id: SEED_TENANT_ID, routine_slot_id: slot.id, teacher_id: owner.teacherId });
      if (weekday === 2) tueSlotId = slot.id;
    }
    // Subject Y is taught nowhere in the plan table: a no-plan period is never flagged.
    void subjectY;
    await ds.getRepository(StudyPlan).save({
      tenant_id: SEED_TENANT_ID,
      academic_year_id: yearId,
      academic_term_id: null,
      section_id: sectionId,
      subject_id: subjectX,
      lessons: [{ id: 'L1', title: 'L1', periods: 5 }],
      exam_markers: [],
    });
  });

  const reminderPushes = () => pushed.filter((p) => p.type === 'study-plan.unreported');

  describe('reminder recipients', () => {
    it('sends the owner one push for yesterday; a substitute gets it instead of the owner', async () => {
      await deliver(MON, { status: 'TAUGHT' });
      let rows = await scheduler.collectUnreported(SEED_TENANT_ID);
      await scheduler.runReminder(SEED_TENANT_ID, '2047-03-13', rows);
      expect(reminderPushes().map((p) => p.userId)).toEqual([owner.userId]);

      pushed = [];
      await ds.getRepository(RoutineSubstitution).save({
        tenant_id: SEED_TENANT_ID,
        routine_slot_id: tueSlotId,
        date: TUE,
        substitute_teacher_id: substitute.teacherId,
        is_cancelled: false,
        created_by: SEED_ADMIN_USER_ID,
      } as never);
      rows = await scheduler.collectUnreported(SEED_TENANT_ID);
      await scheduler.runReminder(SEED_TENANT_ID, '2047-03-13', rows);
      // The substitute covers Tuesday; the owner has nothing left yesterday.
      expect(reminderPushes().map((p) => p.userId)).toEqual([substitute.userId]);
    });

    it('never flags an ON_LEAVE auto row or a cancelled occurrence', async () => {
      await deliver(MON, { status: 'TAUGHT' });
      await deliver(TUE, { status: 'NOT_TAUGHT', reason: 'ON_LEAVE', auto: true });
      let rows = await scheduler.collectUnreported(SEED_TENANT_ID);
      expect(rows.filter((r) => r.date === TUE)).toHaveLength(0);

      await ds.query('DELETE FROM lesson_deliveries WHERE date = $1', [TUE]);
      await ds.getRepository(RoutineSubstitution).save({
        tenant_id: SEED_TENANT_ID,
        routine_slot_id: tueSlotId,
        date: TUE,
        substitute_teacher_id: null,
        is_cancelled: true,
        created_by: SEED_ADMIN_USER_ID,
      } as never);
      rows = await scheduler.collectUnreported(SEED_TENANT_ID);
      expect(rows.filter((r) => r.date === TUE)).toHaveLength(0);
    });
  });

  describe('escalation recipients', () => {
    it('reaches every ADMIN and EXECUTIVE, not other roles, inactive users or another tenant', async () => {
      const admin = await member('admin', UserRole.ADMIN);
      const exec = await member('exec', UserRole.EXECUTIVE);
      const teacher = await member('teacher', UserRole.TEACHER);
      const accountant = await member('acct', UserRole.ACCOUNTANT);
      const committee = await member('comm', UserRole.COMMITTEE);
      const inactive = await member('off', UserRole.ADMIN, SEED_TENANT_ID, UserStatus.INACTIVE);
      const otherTenantAdmin = await member('b-admin', UserRole.ADMIN, TENANT_B);

      // Monday is two working days back from Wednesday: unreported -> escalated.
      const rows = await scheduler.collectUnreported(SEED_TENANT_ID);
      expect(rows.some((r) => r.date === MON)).toBe(true);
      await scheduler.runEscalation(SEED_TENANT_ID, '2047-03-13', rows, SETTINGS);
      const got = pushed.map((p) => p.userId);
      expect(got).toEqual(expect.arrayContaining([admin, exec]));
      for (const not of [teacher, accountant, committee, inactive, otherTenantAdmin]) {
        expect(got).not.toContain(not);
      }
      expect(pushed.every((p) => p.tenantId === SEED_TENANT_ID)).toBe(true);
    });
  });

  describe('digest', () => {
    async function student(
      tag: string,
      section: string,
      status = EnrollmentStatus.ACTIVE,
    ): Promise<Student> {
      return (await ds.getRepository(Student).save({
        tenant_id: SEED_TENANT_ID,
        full_name: `SF kid ${tag} ${suffix}`,
        registration_number: `SF-${tag}-${suffix}-${Math.random()}`,
        roll_number: Math.floor(Math.random() * 1e6),
        class_section_id: section,
        enrollment_status: status,
      } as never)) as unknown as Student;
    }
    async function guardianOf(
      kid: Student,
      tag: string,
      userId: string | null,
      tenant = SEED_TENANT_ID,
    ) {
      const g = (await ds.getRepository(Guardian).save({
        tenant_id: tenant,
        full_name: `SF guardian ${tag}`,
        relationship: 'Father',
        user_id: userId,
      } as never)) as unknown as Guardian;
      kid.guardians = [...(kid.guardians ?? []), g];
      await ds.getRepository(Student).save(kid);
    }

    it('guardians get one push naming only behind subjects; no-user, withdrawn and on-track children get none', async () => {
      const behindKid = await student('behind', sectionId);
      const withdrawn = await student('gone', sectionId, EnrollmentStatus.INACTIVE);
      const onTrack = await student('ontrack', otherSectionId); // section has no plan
      const gUser = await makeUser('g1');
      const gUser2 = await makeUser('g2');
      const gUser3 = await makeUser('g3');
      await guardianOf(behindKid, 'one', gUser.id);
      await guardianOf(behindKid, 'nouser', null);
      await guardianOf(withdrawn, 'two', gUser2.id);
      await guardianOf(onTrack, 'three', gUser3.id);
      const committeeUser = await member('comm2', UserRole.COMMITTEE);

      await scheduler.runDigest(SEED_TENANT_ID, SETTINGS);

      const digest = pushed.filter((p) => p.type === 'study-plan.digest');
      const mine = digest.filter((p) => p.userId === gUser.id);
      expect(mine).toHaveLength(1);
      expect(mine[0].body).toContain('বিষয়X');
      expect(mine[0].body).toContain('পিছিয়ে');
      expect(digest.map((p) => p.userId)).not.toContain(gUser2.id);
      expect(digest.map((p) => p.userId)).not.toContain(gUser3.id);

      // Committee: one aggregate push, class lines only, no teacher name.
      const comm = digest.filter((p) => p.userId === committeeUser);
      expect(comm).toHaveLength(1);
      expect(comm[0].body).toContain('পাঠ পরিকল্পনার');
      expect(comm[0].body).not.toContain(owner.name);
      expect(comm[0].body).not.toContain(substitute.name);
    });

    it("tenant B's guardian is never a recipient of tenant A's run", async () => {
      const kid = await student('iso', sectionId);
      const bUser = await makeUser('b-guardian');
      await guardianOf(kid, 'b', bUser.id, TENANT_B);
      const bCommittee = await member('b-comm', UserRole.COMMITTEE, TENANT_B);
      await scheduler.runDigest(SEED_TENANT_ID, SETTINGS);
      const got = pushed.map((p) => p.userId);
      expect(got).not.toContain(bUser.id);
      expect(got).not.toContain(bCommittee);
    });
  });
});
