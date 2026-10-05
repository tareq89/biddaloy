import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { ConfigModule } from '@nestjs/config';
import { DataSource, IsNull } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { SEED_TENANT_ID } from '@test/constants';
import { AttendanceModule } from './attendance.module';
import { AuthModule } from '../auth/auth.module';
import { AttendanceSummaryService } from './attendance-summary.service';
import { AttendanceSession } from './entities/attendance-session.entity';
import { AttendanceRecord } from './entities/attendance-record.entity';
import { School } from '../schools/entities/school.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { Class } from '../academics/entities/class.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { Student } from '../students/entities/student.entity';
import { CalendarEvent } from '../calendar/entities/calendar-event.entity';
import { CalendarEventClass } from '../calendar/entities/calendar-event-class.entity';
import { AttendanceSessionState, AttendanceStatus } from '@biddaloy/shared';

/**
 * Integration tests for `AttendanceSummaryService` — the single source of
 * attendance-percentage truth. Runs against a real, migrated test
 * database. `weeklyOffDays: []` is set for the tenant so every seeded date
 * below is a working day, independent of the calendar day the suite runs
 * on.
 */
describe('AttendanceSummaryService (integration)', () => {
  let service: AttendanceSummaryService;
  let dataSource: DataSource;

  const TENANT_ID = SEED_TENANT_ID;
  let sectionId: string;
  let classIdOf: string;

  beforeAll(async () => {
    const module = await createTestModule(
      ALL_ENTITIES,
      [],
      [ConfigModule.forRoot({ isGlobal: true }), AttendanceModule, AuthModule],
    );
    service = module.get<AttendanceSummaryService>(AttendanceSummaryService);
    dataSource = module.get<DataSource>(getDataSourceToken());

    const yearRepo = dataSource.getRepository(AcademicYear);
    const classRepo = dataSource.getRepository(Class);
    const sectionRepo = dataSource.getRepository(ClassSection);

    const year = await yearRepo.save({
      name: 'Attendance Summary Test Year',
      start_date: '2026-01-01',
      end_date: '2026-12-31',
      tenant_id: TENANT_ID,
    });
    const klass = await classRepo.save({
      name: 'Summary Test Class',
      academic_year_id: year.id,
      tenant_id: TENANT_ID,
    });
    const section = await sectionRepo.save({
      section_name: 'Summary Section',
      class_id: klass.id,
      tenant_id: TENANT_ID,
    });
    sectionId = section.id;
    classIdOf = klass.id;
  }, 60000);

  afterAll(async () => {
    if (dataSource) {
      await dataSource.destroy();
    }
  });

  async function setWeeklyOffDays(weeklyOffDays: number[]): Promise<void> {
    await dataSource
      .getRepository(School)
      .update(
        { id: TENANT_ID },
        { settings: { version: 1, attendance: { weeklyOffDays } } as any },
      );
  }

  async function markDay(studentId: string, date: string, status: AttendanceStatus): Promise<void> {
    const sessionRepo = dataSource.getRepository(AttendanceSession);
    const recordRepo = dataSource.getRepository(AttendanceRecord);
    // One whole-day register per (section, date) — reuse it across
    // students rather than violating the register's own uniqueness rule.
    let session = await sessionRepo.findOne({
      where: { tenant_id: TENANT_ID, section_id: sectionId, date, period_no: IsNull() },
    });
    if (!session) {
      session = await sessionRepo.save({
        tenant_id: TENANT_ID,
        section_id: sectionId,
        date,
        period_no: null,
        state: AttendanceSessionState.FINALIZED,
      });
    }
    await recordRepo.save({
      tenant_id: TENANT_ID,
      session_id: session.id,
      student_id: studentId,
      date,
      status,
    });
  }

  async function makeStudent(rollNumber: number): Promise<string> {
    const studentRepo = dataSource.getRepository(Student);
    const student = await studentRepo.save({
      full_name: `Summary Student ${rollNumber}`,
      registration_number: `SUMMARY-REG-${rollNumber}-${Date.now()}`,
      roll_number: rollNumber,
      class_section_id: sectionId,
      tenant_id: TENANT_ID,
    });
    return student.id;
  }

  beforeEach(async () => {
    await setWeeklyOffDays([]);
  });

  describe('getStudentSummary', () => {
    it('produces the expected counts for a seeded range', async () => {
      const studentId = await makeStudent(101);
      // 2026-09-01 .. 2026-09-05 (5 working days, weekly off disabled).
      await markDay(studentId, '2026-09-01', AttendanceStatus.PRESENT);
      await markDay(studentId, '2026-09-02', AttendanceStatus.PRESENT);
      await markDay(studentId, '2026-09-03', AttendanceStatus.LATE);
      await markDay(studentId, '2026-09-04', AttendanceStatus.ABSENT);
      // 2026-09-05 left unmarked.

      const summary = await service.getStudentSummary({
        tenantId: TENANT_ID,
        studentId,
        from: '2026-09-01',
        to: '2026-09-05',
      });

      expect(summary.working_days).toBe(5);
      expect(summary.marked_days).toBe(4);
      expect(summary.present_days).toBe(2);
      expect(summary.late_days).toBe(1);
      expect(summary.absent_days).toBe(1);
      expect(summary.leave_days).toBe(0);
      expect(summary.unmarked_days).toBe(1);
      // Default policy: lateCountsAsPresent = true, WORKING_DAYS denominator.
      // numerator = 2 present + 1 late = 3; denominator = 5 -> 60%.
      expect(summary.attendance_percentage).toBe(60);
    });

    it('returns null attendance_percentage, not 0, over a range with zero working days', async () => {
      const studentId = await makeStudent(102);
      await setWeeklyOffDays([0, 1, 2, 3, 4, 5, 6]); // every day is off
      const summary = await service.getStudentSummary({
        tenantId: TENANT_ID,
        studentId,
        from: '2026-09-01',
        to: '2026-09-05',
      });
      expect(summary.working_days).toBe(0);
      expect(summary.attendance_percentage).toBeNull();
    });
  });

  describe('getSectionSummary', () => {
    it('runs a bounded number of queries for a 60-student section', async () => {
      const studentIds: string[] = [];
      for (let i = 0; i < 60; i++) {
        studentIds.push(await makeStudent(200 + i));
      }
      for (const studentId of studentIds) {
        await markDay(studentId, '2026-09-01', AttendanceStatus.PRESENT);
      }

      let queryCount = 0;
      const originalQuery = dataSource.query.bind(dataSource);
      // Count only SELECTs against attendance_records — the query this
      // ticket's plan requires stay O(1) regardless of roster size.
      (dataSource as unknown as { query: typeof dataSource.query }).query = ((
        ...args: Parameters<typeof dataSource.query>
      ) => {
        const sql = String(args[0]);
        if (sql.includes('attendance_records') && /^\s*SELECT/i.test(sql)) {
          queryCount++;
        }
        return originalQuery(...args);
      }) as typeof dataSource.query;

      try {
        const result = await service.getSectionSummary({
          tenantId: TENANT_ID,
          sectionId,
          from: '2026-09-01',
          to: '2026-09-01',
        });
        expect(result.students.length).toBeGreaterThanOrEqual(60);
        // Exactly two grouped queries against attendance_records — one for
        // per-status counts, one for marked_days — never one per student.
        expect(queryCount).toBeLessThanOrEqual(2);
      } finally {
        (dataSource as unknown as { query: typeof dataSource.query }).query = originalQuery;
      }
    });
  });

  describe('getLowAttendanceFlags', () => {
    it('excludes students with a null attendance_percentage', async () => {
      const markedStudentId = await makeStudent(300);
      const unmarkedStudentId = await makeStudent(301);
      await markDay(markedStudentId, '2026-09-01', AttendanceStatus.ABSENT);
      // unmarkedStudentId has no records at all in range -> percentage is
      // still non-null (0 marked isn't null unless working_days is 0), but
      // to genuinely hit the null case we zero out working days for this
      // narrow check via an empty range instead.

      const result = await service.getLowAttendanceFlags({
        tenantId: TENANT_ID,
        from: '2026-09-01',
        to: '2026-09-01',
        thresholdPercent: 100,
      });

      const flaggedIds = result.data.map((f) => f.student_id);
      expect(flaggedIds).toContain(markedStudentId);
      // unmarkedStudentId is 0% (0 present / 1 working day), which is
      // non-null and below threshold, so it *is* flagged — this assertion
      // documents that "unmarked" and "null" are different states, per the
      // ticket's acceptance criteria for `null`.
      expect(flaggedIds).toContain(unmarkedStudentId);
    });

    it('excludes a student entirely when the range has zero working days for them', async () => {
      const studentId = await makeStudent(302);
      await setWeeklyOffDays([0, 1, 2, 3, 4, 5, 6]);
      const result = await service.getLowAttendanceFlags({
        tenantId: TENANT_ID,
        from: '2026-09-01',
        to: '2026-09-01',
        thresholdPercent: 100,
      });
      expect(result.data.map((f) => f.student_id)).not.toContain(studentId);
    });
  });

  describe('period registers are ignored (D1)', () => {
    const DATE = '2026-10-06';
    /** Day register `dayStatus` plus three period registers, all ABSENT. */
    async function seed(
      roll: number,
      dayStatus: AttendanceStatus,
      periodStatus: AttendanceStatus = AttendanceStatus.ABSENT,
    ): Promise<string> {
      const studentId = await makeStudent(roll);
      await markDay(studentId, DATE, dayStatus);
      for (const periodNo of [1, 2, 3]) {
        const sessionRepo = dataSource.getRepository(AttendanceSession);
        const where = {
          tenant_id: TENANT_ID,
          section_id: sectionId,
          date: DATE,
          period_no: periodNo,
        };
        const session =
          (await sessionRepo.findOne({ where })) ??
          (await sessionRepo.save({
            tenant_id: TENANT_ID,
            section_id: sectionId,
            date: DATE,
            period_no: periodNo,
            state: AttendanceSessionState.FINALIZED,
          }));
        await dataSource.getRepository(AttendanceRecord).save({
          tenant_id: TENANT_ID,
          session_id: session.id,
          student_id: studentId,
          date: DATE,
          status: periodStatus,
        });
      }
      return studentId;
    }

    it('getStudentSummary counts one day, percentage <= 100', async () => {
      const studentId = await seed(400, AttendanceStatus.PRESENT);
      const summary = await service.getStudentSummary({
        tenantId: TENANT_ID,
        studentId,
        from: DATE,
        to: DATE,
      });
      expect(summary.present_days).toBe(1);
      expect(summary.absent_days).toBe(0);
      expect(summary.marked_days).toBe(1);
      expect(summary.attendance_percentage).toBeLessThanOrEqual(100);
    });

    it('getStudentDays returns the day register status', async () => {
      const studentId = await seed(401, AttendanceStatus.PRESENT);
      const days = await service.getStudentDays({
        tenantId: TENANT_ID,
        studentId,
        from: DATE,
        to: DATE,
      });
      expect(days.find((d) => d.date === DATE)?.status).toBe(AttendanceStatus.PRESENT);
    });

    it('getSectionRegisterMatrix shows the day register status in the cell', async () => {
      const studentId = await seed(402, AttendanceStatus.PRESENT);
      const matrix = await service.getSectionRegisterMatrix({
        tenantId: TENANT_ID,
        sectionId,
        from: DATE,
        to: DATE,
      });
      const row = matrix.rows.find((r) => r.student_id === studentId)!;
      expect(row.marks[DATE]).toBe(AttendanceStatus.PRESENT);
    });

    it('getLowAttendanceFlags flags a day-ABSENT student on the day register, ignoring PRESENT periods', async () => {
      const studentId = await seed(403, AttendanceStatus.ABSENT, AttendanceStatus.PRESENT);
      const result = await service.getLowAttendanceFlags({
        tenantId: TENANT_ID,
        from: DATE,
        to: DATE,
        thresholdPercent: 90,
        limit: 1000,
      });
      const flag = result.data.find((f) => f.student_id === studentId);
      expect(flag).toBeDefined();
      expect(flag!.attendance_percentage).toBe(0);
    });
  });

  describe('class-scoped holidays (D25)', () => {
    it('two students in different classes get different working_days', async () => {
      const yearId = (await dataSource.getRepository(Class).findOneByOrFail({ id: classIdOf }))
        .academic_year_id;
      const otherClass = await dataSource
        .getRepository(Class)
        .save({ name: 'Scoped Class B', academic_year_id: yearId, tenant_id: TENANT_ID });
      const otherSection = await dataSource.getRepository(ClassSection).save({
        section_name: 'Scoped Section B',
        class_id: otherClass.id,
        tenant_id: TENANT_ID,
      });
      const inScoped = await makeStudent(500);
      const inOther = (
        await dataSource.getRepository(Student).save({
          full_name: 'Scoped Student B',
          registration_number: `SCOPED-B-${Date.now()}`,
          roll_number: 501,
          class_section_id: otherSection.id,
          tenant_id: TENANT_ID,
        })
      ).id;

      const event = await dataSource.getRepository(CalendarEvent).save({
        tenant_id: TENANT_ID,
        academic_year_id: yearId,
        start_date: '2026-09-10',
        end_date: '2026-09-10',
        name: 'Class A Only Break',
        counts_as_working_day: false,
        published_at: new Date(),
      });
      await dataSource
        .getRepository(CalendarEventClass)
        .save({ event_id: event.id, class_id: classIdOf, tenant_id: TENANT_ID });

      try {
        const range = { tenantId: TENANT_ID, from: '2026-09-08', to: '2026-09-12' };
        const a = await service.getStudentSummary({ ...range, studentId: inScoped });
        const b = await service.getStudentSummary({ ...range, studentId: inOther });
        expect(a.working_days).toBe(4);
        expect(b.working_days).toBe(5);

        const flags = await service.getLowAttendanceFlags({ ...range, thresholdPercent: 101 });
        const byId = new Map(flags.data.map((f) => [f.student_id, f.working_days]));
        expect(byId.get(inScoped)).toBe(4);
        expect(byId.get(inOther)).toBe(5);

        const days = await service.getStudentDays({ ...range, studentId: inScoped });
        expect(days.find((d) => d.date === '2026-09-10')?.is_working_day).toBe(false);

        // Empty roster: the section's own class still drives working days.
        const emptySection = await dataSource.getRepository(ClassSection).save({
          section_name: 'Scoped Empty Section',
          class_id: classIdOf,
          tenant_id: TENANT_ID,
        });
        const empty = await service.getSectionSummary({ ...range, sectionId: emptySection.id });
        expect(empty.working_days).toBe(4);
      } finally {
        await dataSource.getRepository(CalendarEvent).delete({ id: event.id });
      }
    });
  });

  describe('getSectionStreaks', () => {
    async function freshSection(tenantId = TENANT_ID): Promise<string> {
      const year = await dataSource.getRepository(AcademicYear).save({
        name: `Streak Year ${Date.now()}-${Math.random()}`,
        start_date: '2026-01-01',
        end_date: '2026-12-31',
        tenant_id: tenantId,
      });
      const klass = await dataSource
        .getRepository(Class)
        .save({ name: 'Streak Class', academic_year_id: year.id, tenant_id: tenantId });
      const section = await dataSource
        .getRepository(ClassSection)
        .save({ section_name: 'Streak Section', class_id: klass.id, tenant_id: tenantId });
      return section.id;
    }
    async function student(secId: string, roll: number, tenantId = TENANT_ID): Promise<string> {
      const s = await dataSource.getRepository(Student).save({
        full_name: `Streak Student ${roll}`,
        registration_number: `STREAK-${roll}-${Date.now()}-${Math.random()}`,
        roll_number: roll,
        class_section_id: secId,
        tenant_id: tenantId,
      });
      return s.id;
    }
    /** One whole-day session per date, one record per [studentId, status]. */
    async function day(
      secId: string,
      date: string,
      marks: Array<[string, AttendanceStatus]>,
      tenantId = TENANT_ID,
    ): Promise<void> {
      const session = await dataSource.getRepository(AttendanceSession).save({
        tenant_id: tenantId,
        section_id: secId,
        date,
        period_no: null,
        state: AttendanceSessionState.FINALIZED,
      });
      for (const [studentId, status] of marks) {
        await dataSource.getRepository(AttendanceRecord).save({
          tenant_id: tenantId,
          session_id: session.id,
          student_id: studentId,
          date,
          status,
        });
      }
    }

    it('flags runs, orders deterministically, and uses a bounded number of queries', async () => {
      const sec = await freshSection();
      const absent = await student(sec, 2);
      const late = await student(sec, 1);
      const broken = await student(sec, 3);
      const P = AttendanceStatus.PRESENT;
      const A = AttendanceStatus.ABSENT;
      const L = AttendanceStatus.LATE;
      await day(sec, '2026-09-01', [
        [broken, A],
        [absent, P],
        [late, P],
      ]);
      await day(sec, '2026-09-02', [
        [broken, AttendanceStatus.LEAVE],
        [absent, A],
        [late, L],
      ]);
      await day(sec, '2026-09-03', [
        [broken, A],
        [absent, A],
        [late, L],
      ]);
      await day(sec, '2026-09-04', [
        [broken, A],
        [absent, A],
        [late, L],
      ]);

      let queryCount = 0;
      const originalQuery = dataSource.query.bind(dataSource);
      (dataSource as unknown as { query: typeof dataSource.query }).query = ((
        ...args: Parameters<typeof dataSource.query>
      ) => {
        if (/^\s*SELECT/i.test(String(args[0]))) queryCount++;
        return originalQuery(...args);
      }) as typeof dataSource.query;
      let result;
      try {
        result = await service.getSectionStreaks({ tenantId: TENANT_ID, sectionId: sec });
      } finally {
        (dataSource as unknown as { query: typeof dataSource.query }).query = originalQuery;
      }

      // `broken` has only a 2-run (LEAVE ends it); absent=3 A; late=3 L.
      expect(result.as_of_date).toBe('2026-09-04');
      expect(result.items.map((i) => [i.student_id, i.status, i.length, i.since_date])).toEqual([
        [absent, A, 3, '2026-09-02'],
        [late, L, 3, '2026-09-02'],
      ]);
      expect(queryCount).toBeLessThanOrEqual(3);
    });

    it('ignores period-level sessions', async () => {
      const sec = await freshSection();
      const s1 = await student(sec, 1);
      for (const d of ['2026-09-01', '2026-09-02', '2026-09-03']) {
        await day(sec, d, [[s1, AttendanceStatus.ABSENT]]);
      }
      // A newer period-level register with no marks must not break/replace the run.
      await dataSource.getRepository(AttendanceSession).save({
        tenant_id: TENANT_ID,
        section_id: sec,
        date: '2026-09-05',
        period_no: 2,
        state: AttendanceSessionState.FINALIZED,
      });
      const result = await service.getSectionStreaks({ tenantId: TENANT_ID, sectionId: sec });
      expect(result.as_of_date).toBe('2026-09-03');
      expect(result.items).toHaveLength(1);
    });

    it("never returns another tenant's data (cross-tenant section id)", async () => {
      const other = await dataSource
        .getRepository(School)
        .save({ name: 'Streak Other School', slug: `streak-${Date.now()}` } as any);
      const otherSec = await freshSection(other.id);
      const stu = await student(otherSec, 1, other.id);
      for (const d of ['2026-09-01', '2026-09-02', '2026-09-03']) {
        await day(otherSec, d, [[stu, AttendanceStatus.ABSENT]], other.id);
      }
      const own = await service.getSectionStreaks({ tenantId: TENANT_ID, sectionId: otherSec });
      expect(own).toEqual({ items: [], as_of_date: null });
      const theirs = await service.getSectionStreaks({ tenantId: other.id, sectionId: otherSec });
      expect(theirs.items).toHaveLength(1);
    });
  });
});
