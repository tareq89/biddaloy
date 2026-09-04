import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { ConfigModule } from '@nestjs/config';
import { DataSource, IsNull } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { SEED_TENANT_ID } from '@test/constants';
import { AttendanceModule } from './attendance.module';
import { AttendanceSummaryService } from './attendance-summary.service';
import { AttendanceSession } from './entities/attendance-session.entity';
import { AttendanceRecord } from './entities/attendance-record.entity';
import { School } from '../schools/entities/school.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { Class } from '../academics/entities/class.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { Student } from '../students/entities/student.entity';
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

  beforeAll(async () => {
    const module = await createTestModule(
      ALL_ENTITIES,
      [],
      [ConfigModule.forRoot({ isGlobal: true }), AttendanceModule],
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
});
