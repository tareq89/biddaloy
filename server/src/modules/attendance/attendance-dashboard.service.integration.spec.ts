import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest';
import { ConfigModule } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import type Redis from 'ioredis';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { SEED_TENANT_ID, SEED_ADMIN_USER_ID } from '@test/constants';
import {
  AttendanceSessionState,
  AttendanceStatus,
  DashboardWidgetKey,
  EnrollmentStatus,
  TeacherAssignmentType,
  TeacherDesignation,
  UserRole,
} from '@biddaloy/shared';
import { Teacher } from '../academics/entities/teacher.entity';
import { Enrollment } from '../students/entities/enrollment.entity';
import { AttendanceSummaryService } from './attendance-summary.service';
import { AttendanceModule } from './attendance.module';
import { AuthModule } from '../auth/auth.module';
import { AttendanceDashboardService } from './attendance-dashboard.service';
import { AttendanceService } from './attendance.service';
import { computeAttendancePercentage } from './attendance-summary.service';
import { AttendanceSession } from './entities/attendance-session.entity';
import { AttendanceRecord } from './entities/attendance-record.entity';
import { School } from '../schools/entities/school.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { Class } from '../academics/entities/class.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { Student } from '../students/entities/student.entity';
import { CalendarEvent } from '../calendar/entities/calendar-event.entity';
import { CalendarEventClass } from '../calendar/entities/calendar-event-class.entity';
import { TENANT_STATUS_REDIS } from '../schools/tenant-status.service';
import { enrollStudent } from '@test/helpers/enrollment.helper';

/**
 * [8.10.7.2.01] The widget must agree with `GET /attendance/my-sections` for a
 * tenant-wide caller. Other fixtures in the shared seed tenant can add sections,
 * so assertions about "my" sections filter by id; totals are compared with
 * `listMySections` itself.
 */
describe('AttendanceDashboardService (integration)', () => {
  let service: AttendanceDashboardService;
  let attendance: AttendanceService;
  let summary: AttendanceSummaryService;
  let dataSource: DataSource;
  let redis: Redis;

  const TENANT_ID = SEED_TENANT_ID;
  const OTHER_TENANT = '00000000-0000-4000-8000-000000000098';
  let yearId: string;
  let secA: { id: string; classId: string };
  let secB: { id: string; classId: string };
  let otherSectionId: string;
  let n = 0;

  const isoOffset = (date: string, days: number) => {
    const d = new Date(`${date}T00:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  };

  async function setSettings(tenantId: string, attendance: object = { weeklyOffDays: [] }) {
    await dataSource.getRepository(School).update(
      { id: tenantId },
      {
        settings: { version: 1, region: { timezone: 'Asia/Dhaka' }, attendance } as any,
      },
    );
  }

  async function makeSection(tenantId: string, year: string, name: string) {
    const klass = await dataSource
      .getRepository(Class)
      .save({ name: `Dash ${name}`, academic_year_id: year, tenant_id: tenantId });
    const section = await dataSource
      .getRepository(ClassSection)
      .save({ section_name: name, class_id: klass.id, tenant_id: tenantId });
    return { id: section.id, classId: klass.id };
  }

  async function mark(
    tenantId: string,
    sectionId: string,
    date: string,
    statuses: AttendanceStatus[],
    opts: { periodNo?: number | null; state?: AttendanceSessionState } = {},
  ) {
    const session = await dataSource.getRepository(AttendanceSession).save({
      tenant_id: tenantId,
      section_id: sectionId,
      date,
      period_no: opts.periodNo ?? null,
      state: opts.state ?? AttendanceSessionState.FINALIZED,
    });
    for (const status of statuses) {
      n += 1;
      const student = await dataSource.getRepository(Student).save({
        full_name: `Dash Student ${n}`,
        registration_number: `DASH-REG-${n}-${Date.now()}`,
        roll_number: n,
        class_section_id: sectionId,
        tenant_id: tenantId,
      });
      await enrollStudent(dataSource, student);
      await dataSource.getRepository(AttendanceRecord).save({
        tenant_id: tenantId,
        session_id: session.id,
        student_id: student.id,
        date,
        status,
      });
    }
  }

  const P = AttendanceStatus.PRESENT;
  const L = AttendanceStatus.LATE;
  const A = AttendanceStatus.ABSENT;

  const widget = () => service.getToday(TENANT_ID, UserRole.ADMIN, SEED_ADMIN_USER_ID);

  async function clearCaches() {
    const keys = [
      ...(await redis.keys(`tenant:${TENANT_ID}:dash:v1:${DashboardWidgetKey.ATTENDANCE_TODAY}:*`)),
      ...(await redis.keys(`tenant:${TENANT_ID}:dash:v1:${DashboardWidgetKey.MY_PENDING_SECTIONS}:*`)),
      ...(await redis.keys(
        `tenant:${TENANT_ID}:dash:v1:${DashboardWidgetKey.CLASS_TEACHER_STREAKS}:*`,
      )),
    ];
    if (keys.length) await redis.del(...keys);
  }

  beforeAll(async () => {
    const module = await createTestModule(
      ALL_ENTITIES,
      [],
      [ConfigModule.forRoot({ isGlobal: true }), AttendanceModule, AuthModule],
    );
    service = module.get(AttendanceDashboardService);
    attendance = module.get(AttendanceService);
    summary = module.get(AttendanceSummaryService);
    dataSource = module.get<DataSource>(getDataSourceToken());
    redis = module.get(TENANT_STATUS_REDIS);

    const schoolRepo = dataSource.getRepository(School);
    if (!(await schoolRepo.findOne({ where: { id: OTHER_TENANT } }))) {
      await schoolRepo.save({ id: OTHER_TENANT, name: 'Dash Other', slug: 'dash-other' });
    }
    const yearRepo = dataSource.getRepository(AcademicYear);
    await yearRepo.update({ tenant_id: TENANT_ID }, { is_current: false });
    const year = await yearRepo.save({
      name: 'Dash Year',
      start_date: '2026-01-01',
      end_date: '2030-12-31',
      is_current: true,
      tenant_id: TENANT_ID,
    });
    yearId = year.id;
    secA = await makeSection(TENANT_ID, yearId, 'DashA');
    secB = await makeSection(TENANT_ID, yearId, 'DashB');
    const otherYear = await yearRepo.save({
      name: 'Dash Other Year',
      start_date: '2026-01-01',
      end_date: '2030-12-31',
      tenant_id: OTHER_TENANT,
    });
    otherSectionId = (await makeSection(OTHER_TENANT, otherYear.id, 'DashX')).id;
  }, 60000);

  beforeEach(async () => {
    await setSettings(TENANT_ID);
    await clearCaches();
    // Fresh registers each test: drop only what these specs wrote.
    await dataSource.query(
      `DELETE FROM attendance_records WHERE student_id IN (SELECT id FROM students WHERE full_name LIKE 'Dash Student%')`,
    );
    await dataSource.query(`DELETE FROM attendance_sessions WHERE section_id IN ($1,$2,$3)`, [
      secA.id,
      secB.id,
      otherSectionId,
    ]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  afterAll(async () => {
    await clearCaches();
    await dataSource?.destroy();
  });

  // Reads the date, then drops the cache that read left behind.
  const today = async () => {
    const { date } = await widget();
    await clearCaches();
    return date;
  };

  it('lists exactly the section with no finalised register as pending, and uses the policy formula', async () => {
    const date = await today();
    await mark(TENANT_ID, secA.id, date, [P, P, P, L, A]); // finalised: 3 present, 1 late, 1 absent
    await clearCaches();
    const w = await widget();

    const mine = w.pending_sections.filter((s) => [secA.id, secB.id].includes(s.section_id));
    expect(mine.map((s) => s.section_id)).toEqual([secB.id]);

    // Compared with the same formula over the summed counts the widget reports.
    const marked = w.counts.present + w.counts.late + w.counts.absent + w.counts.leave;
    expect(w.percentage).toBe(
      computeAttendancePercentage(
        {
          present_days: w.counts.present,
          late_days: w.counts.late,
          absent_days: w.counts.absent,
          leave_days: w.counts.leave,
          working_days: marked,
          marked_days: marked,
        },
        {
          percentageDenominator: 'WORKING_DAYS',
          leaveCountsAsWorkingDay: true,
          lateCountsAsPresent: true,
        },
      ),
    );
    expect(w.counts.present).toBeGreaterThanOrEqual(3);
    expect(w.series).toHaveLength(30);
    expect(w.series[29]).toEqual({ date, percentage: w.percentage });
  });

  it('reconciles with listMySections for a tenant-wide caller', async () => {
    const date = await today();
    await mark(TENANT_ID, secA.id, date, [P, P, A]);
    await mark(TENANT_ID, secB.id, date, [P, L], { state: AttendanceSessionState.DRAFT });
    await clearCaches();
    const w = await widget();
    const rows = await attendance.listMySections({
      role: UserRole.ADMIN,
      userId: SEED_ADMIN_USER_ID,
      tenantId: TENANT_ID,
      date,
    });
    const sum = (k: 'present' | 'late' | 'absent' | 'leave' | 'unmarked') =>
      rows.reduce((t, r) => t + (r.today?.[k] ?? 0), 0);
    expect(w.counts).toEqual({
      present: sum('present'),
      late: sum('late'),
      absent: sum('absent'),
      leave: sum('leave'),
      unmarked: sum('unmarked'),
    });
    expect(w.sections_total).toBe(rows.length);
    // A DRAFT register is not "done".
    expect(w.pending_sections.map((s) => s.section_id)).toContain(secB.id);
  });

  it('does not count a period register on the same day', async () => {
    const date = await today();
    await mark(TENANT_ID, secA.id, date, [P, P], { periodNo: 2 });
    await clearCaches();
    const w = await widget();
    expect(w.pending_sections.map((s) => s.section_id)).toContain(secA.id);
    const point = (await service.computeSeries(TENANT_ID, date)).at(-1)!;
    expect(point.percentage).toBeNull(); // only a period register exists for today in my sections
  });

  it('a class-scoped holiday makes that section non-working and not pending', async () => {
    const date = await today();
    const event = await dataSource.getRepository(CalendarEvent).save({
      tenant_id: TENANT_ID,
      academic_year_id: yearId,
      start_date: date,
      end_date: date,
      name: 'Dash Break',
      counts_as_working_day: false,
      published_at: new Date(),
    });
    await dataSource
      .getRepository(CalendarEventClass)
      .save({ event_id: event.id, class_id: secA.classId, tenant_id: TENANT_ID });
    try {
      const w = await widget();
      const ids = w.pending_sections.map((s) => s.section_id);
      expect(ids).not.toContain(secA.id);
      expect(ids).toContain(secB.id);
    } finally {
      await dataSource.getRepository(CalendarEventClass).delete({ event_id: event.id });
      await dataSource.getRepository(CalendarEvent).delete({ id: event.id });
    }
  });

  it('series: day -1 and day -8 are points, the rest null; week_ago is the day -7 point', async () => {
    const date = await today();
    await mark(TENANT_ID, secA.id, isoOffset(date, -1), [P, A]);
    await mark(TENANT_ID, secA.id, isoOffset(date, -8), [P, P, P, A]);
    await clearCaches();
    const w = await widget();
    expect(w.series).toHaveLength(30);
    const byDate = new Map(w.series.map((p) => [p.date, p.percentage]));
    expect(byDate.get(isoOffset(date, -1))).not.toBeNull();
    expect(byDate.get(isoOffset(date, -8))).not.toBeNull();
    expect(byDate.get(isoOffset(date, -7))).toBeNull();
    expect(w.week_ago_percentage).toBeNull();
    // Day -8 had 3 of 4 present across my sections (and nothing else in the seed tenant).
    expect(byDate.get(isoOffset(date, -8))).toBeGreaterThan(0);
  });

  it('serves yesterday from the nightly key rather than recomputing', async () => {
    const date = await today();
    const key = service.seriesKey(TENANT_ID, isoOffset(date, -1));
    const fake = Array.from({ length: 30 }, (_, i) => ({
      date: isoOffset(date, -30 + i),
      percentage: 77,
    }));
    await redis.set(key, JSON.stringify(fake), 'EX', 60);
    const w = await widget();
    expect(w.week_ago_percentage).toBe(77);
    expect(w.series[28].percentage).toBe(77);
  });

  it('Dhaka midnight: 17:59Z is still 7 Oct, 18:00Z is 8 Oct', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-07T17:59:00Z'));
    expect((await widget()).date).toBe('2026-10-07');
    await clearCaches();
    vi.setSystemTime(new Date('2026-10-07T18:00:00Z'));
    expect((await widget()).date).toBe('2026-10-08');
  });

  it("another tenant's records never change this tenant's counts", async () => {
    const date = await today();
    const before = (await widget()).counts;
    await mark(OTHER_TENANT, otherSectionId, date, [P, P, P, A]);
    await clearCaches();
    expect((await widget()).counts).toEqual(before);
    const series = await service.computeSeries(TENANT_ID, date);
    expect(series.at(-1)!.percentage).toBeNull();
  });

  // [8.10.7.3.02] Teacher widgets: my-pending-sections and class-teacher-streaks.
  describe('teacher widgets', () => {
    const tag = Date.now().toString(36);
    let teacherUserId: string;
    let lonelyUserId: string;
    let secDone: { id: string; classId: string };
    let secDraft: { id: string; classId: string };
    let secNone: { id: string; classId: string };
    let secPast: { id: string; classId: string };

    // The per-test DB reset empties teachers / assignments / students, so those are seeded in
    // beforeEach; users and sections survive and are made once in beforeAll.
    const makeUser = async (name: string) => {
      const [user] = await dataSource.query(
        `INSERT INTO users (email, password_hash, full_name, status, created_at, updated_at)
         VALUES ($1, 'x', $2, 'ACTIVE', NOW(), NOW()) RETURNING id`,
        [`dash-t-${name}-${tag}@e2e.example`, `Dash T ${name}`],
      );
      return user.id as string;
    };
    const makeTeacher = async (userId: string, name: string) =>
      (
        await dataSource.getRepository(Teacher).save({
          user_id: userId,
          employee_id: `EMP-DT-${name}-${tag}`,
          tenant_id: TENANT_ID,
          designations: [TeacherDesignation.SUBJECT_TEACHER],
        })
      ).id;
    const assign = (teacherId: string, sectionId: string, type: TeacherAssignmentType) =>
      dataSource.query(
        `INSERT INTO teacher_class_sections (teacher_id, section_id, tenant_id, assignment_type)
         VALUES ($1, $2, $3, $4)`,
        [teacherId, sectionId, TENANT_ID, type],
      );
    const addStudent = async (sectionId: string, label: string, tenantId = TENANT_ID) => {
      n += 1;
      const student = await dataSource.getRepository(Student).save({
        full_name: `Dash Student ${label}`,
        registration_number: `DASH-T-${n}-${Date.now()}`,
        roll_number: n,
        class_section_id: sectionId,
        tenant_id: tenantId,
      });
      await enrollStudent(dataSource, student);
      return student;
    };
    const register = async (
      sectionId: string,
      date: string,
      state: AttendanceSessionState,
      marks: Array<[string, AttendanceStatus]> = [],
      tenantId = TENANT_ID,
    ) => {
      const session = await dataSource.getRepository(AttendanceSession).save({
        tenant_id: tenantId,
        section_id: sectionId,
        date,
        period_no: null,
        state,
      });
      for (const [student_id, status] of marks) {
        await dataSource
          .getRepository(AttendanceRecord)
          .save({ tenant_id: tenantId, session_id: session.id, student_id, date, status });
      }
    };
    const pending = (userId = teacherUserId) =>
      service.myPendingSections(TENANT_ID, UserRole.TEACHER, userId);
    const streaks = (userId = teacherUserId, tenantId = TENANT_ID) =>
      service.classTeacherStreaks(tenantId, userId);

    beforeAll(async () => {
      teacherUserId = await makeUser('main');
      lonelyUserId = await makeUser('lonely');
      secDone = await makeSection(TENANT_ID, yearId, 'DashTDone');
      secDraft = await makeSection(TENANT_ID, yearId, 'DashTDraft');
      secNone = await makeSection(TENANT_ID, yearId, 'DashTNone');
      const [py] = await dataSource.query(
        `INSERT INTO academic_years (name, start_date, end_date, is_current, tenant_id, created_at, updated_at)
         VALUES ($1, '2018-01-01', '2018-12-31', false, $2, NOW(), NOW()) RETURNING id`,
        [`Dash Past ${tag}`, TENANT_ID],
      );
      secPast = await makeSection(TENANT_ID, py.id, 'DashTPast');
    }, 60000);

    beforeEach(async () => {
      await setSettings(TENANT_ID);
      await clearCaches();
      const teacherId = await makeTeacher(teacherUserId, 'main');
      await assign(teacherId, secDone.id, TeacherAssignmentType.CLASS_TEACHER);
      await assign(teacherId, secDraft.id, TeacherAssignmentType.ASSISTANT_CLASS_TEACHER);
      await assign(teacherId, secNone.id, TeacherAssignmentType.ASSISTANT_CLASS_TEACHER);
      await assign(teacherId, secPast.id, TeacherAssignmentType.CLASS_TEACHER);
      await makeTeacher(lonelyUserId, 'lonely'); // a teacher with no assignment
    });

    it('pending: counts sections without a finalised register, not-taken first', async () => {
      const date = await today();
      const a = await addStudent(secDone.id, 'td1');
      await addStudent(secDraft.id, 'td2');
      await addStudent(secDraft.id, 'td3');
      await addStudent(secNone.id, 'td4');
      await register(secDone.id, date, AttendanceSessionState.FINALIZED, [[a.id, P]]);
      await register(secDraft.id, date, AttendanceSessionState.DRAFT);
      await clearCaches();
      const w = await pending();
      expect(w.date).toBe(date);
      expect(w.pending_count).toBe(2);
      expect(w.sections.map((s) => [s.section_id, s.taken])).toEqual([
        [secDraft.id, false],
        [secNone.id, false],
        [secDone.id, true],
      ]);
      expect(w.sections.find((s) => s.section_id === secNone.id)!.unmarked).toBe(1);
      expect(w.sections.find((s) => s.section_id === secDraft.id)!.unmarked).toBe(2);
    });

    it('a previous-year section the teacher still maps to is not listed (#1806)', async () => {
      const w = await pending();
      expect(w.sections.map((s) => s.section_id)).not.toContain(secPast.id);
    });

    it('a withdrawn student is not counted (#1805)', async () => {
      await addStudent(secNone.id, 'tw1');
      const left = await addStudent(secNone.id, 'tw2');
      await dataSource
        .getRepository(Enrollment)
        .update({ student_id: left.id }, { enrollment_status: EnrollmentStatus.INACTIVE });
      const w = await pending();
      const row = w.sections.find((s) => s.section_id === secNone.id)!;
      expect(row.student_count).toBe(1);
      expect(row.unmarked).toBe(1);
    });

    it('reconciles with listMySections for the same caller', async () => {
      const date = await today();
      await addStudent(secDraft.id, 'tr1');
      await clearCaches();
      const w = await pending();
      const rows = await attendance.listMySections({
        role: UserRole.TEACHER,
        userId: teacherUserId,
        tenantId: TENANT_ID,
        date,
      });
      expect(w.sections.map((s) => s.section_id).sort()).toEqual(
        rows.map((r) => r.section_id).sort(),
      );
      for (const r of rows) {
        expect(w.sections.find((s) => s.section_id === r.section_id)!.unmarked).toBe(
          r.today?.unmarked ?? r.student_count,
        );
      }
    });

    it('Dhaka midnight: date rolls to the 8th and a register of the 7th is not taken', async () => {
      const s = await addStudent(secNone.id, 'tm1');
      await register(secNone.id, '2026-10-07', AttendanceSessionState.FINALIZED, [[s.id, P]]);
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-10-07T18:30:00Z'));
      const w = await pending();
      expect(w.date).toBe('2026-10-08');
      expect(w.sections.find((x) => x.section_id === secNone.id)!.taken).toBe(false);
    });

    it('is cached per user, not shared between callers', async () => {
      await pending();
      const other = await pending(lonelyUserId);
      expect(other.sections).toEqual([]);
      expect(other.pending_count).toBe(0);
    });

    it('streaks: absent 4 and 3 days listed longest first; a LATE run is not', async () => {
      const date = await today();
      const x = await addStudent(secDone.id, 'ts1');
      const y = await addStudent(secDone.id, 'ts2');
      const z = await addStudent(secDone.id, 'ts3');
      for (const i of [0, 1, 2, 3]) {
        await register(secDone.id, isoOffset(date, -i), AttendanceSessionState.FINALIZED, [
          [x.id, A],
          [y.id, i === 3 ? P : A],
          [z.id, i === 3 ? P : L],
        ]);
      }
      await clearCaches();
      const w = await streaks();
      expect(w.section!.section_id).toBe(secDone.id);
      expect(w.total).toBe(2);
      expect(w.items.map((i) => [i.student_id, i.length])).toEqual([
        [x.id, 4],
        [y.id, 3],
      ]);
      const raw = await summary.getSectionStreaks({ tenantId: TENANT_ID, sectionId: secDone.id });
      expect(w.items.map((i) => i.student_id)).toEqual(
        raw.items.filter((i) => i.status === AttendanceStatus.ABSENT).map((i) => i.student_id),
      );
    });

    it('streaks: a teacher with no homeroom gets an empty widget', async () => {
      expect(await streaks(lonelyUserId)).toEqual({
        section: null,
        as_of_date: null,
        total: 0,
        items: [],
      });
    });

    it("tenant isolation: another tenant's sections and students never appear", async () => {
      const date = await today();
      const s = await addStudent(otherSectionId, 'tx1', OTHER_TENANT);
      await register(
        otherSectionId,
        date,
        AttendanceSessionState.FINALIZED,
        [[s.id, A]],
        OTHER_TENANT,
      );
      await clearCaches();
      const w = await pending();
      expect(w.sections.map((x) => x.section_id)).not.toContain(otherSectionId);
      expect((await streaks()).items.map((i) => i.student_id)).not.toContain(s.id);
      expect((await streaks(teacherUserId, OTHER_TENANT)).section).toBeNull();
    });
  });
});
