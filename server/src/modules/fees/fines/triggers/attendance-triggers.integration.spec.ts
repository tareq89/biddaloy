import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ConfigModule } from '@nestjs/config';
import { DataSource, IsNull } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { AttendanceModule } from '../../../attendance/attendance.module';
import { AuthModule } from '../../../auth/auth.module';
import { AttendanceSession } from '../../../attendance/entities/attendance-session.entity';
import { AttendanceRecord } from '../../../attendance/entities/attendance-record.entity';
import { School } from '../../../schools/entities/school.entity';
import { AcademicYear } from '../../../academics/entities/academic-year.entity';
import { Class } from '../../../academics/entities/class.entity';
import { ClassSection } from '../../../academics/entities/class-section.entity';
import { Student } from '../../../students/entities/student.entity';
import { AttendanceSessionState, AttendanceStatus } from '@biddaloy/shared';
import { attendanceAbsentTrigger } from './attendance-absent.trigger';
import { attendanceLateTrigger } from './attendance-late.trigger';

/**
 * Integration tests for the two attendance `FineTriggerEvaluator`s — real
 * DB, tenant-scoped, against a freshly-seeded tenant/section per file (this
 * worker's shared database, so every id here is unique per run).
 */
describe('attendance fine triggers (integration)', () => {
  let dataSource: DataSource;
  let tenantId: string;
  let sectionId: string;
  let classId: string;

  beforeAll(async () => {
    const module = await createTestModule(
      ALL_ENTITIES,
      [],
      [ConfigModule.forRoot({ isGlobal: true }), AttendanceModule, AuthModule],
    );
    dataSource = module.get<DataSource>(getDataSourceToken());

    const schoolRepo = dataSource.getRepository(School);
    const school = await schoolRepo.save({
      name: `Fine Trigger Test School ${Date.now()}`,
      slug: `fine-trigger-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      settings: { version: 1, attendance: { weeklyOffDays: [] } } as any,
    });
    tenantId = school.id;

    const yearRepo = dataSource.getRepository(AcademicYear);
    const classRepo = dataSource.getRepository(Class);
    const sectionRepo = dataSource.getRepository(ClassSection);

    const year = await yearRepo.save({
      name: 'Fine Trigger Test Year',
      start_date: '2026-01-01',
      end_date: '2026-12-31',
      tenant_id: tenantId,
    });
    const klass = await classRepo.save({
      name: 'Fine Trigger Class A',
      academic_year_id: year.id,
      tenant_id: tenantId,
    });
    const section = await sectionRepo.save({
      section_name: 'FT Section A',
      class_id: klass.id,
      tenant_id: tenantId,
    });
    sectionId = section.id;
    classId = klass.id;
  }, 60000);

  afterAll(async () => {
    if (dataSource) {
      await dataSource.destroy();
    }
  });

  async function makeStudent(label: string): Promise<string> {
    const studentRepo = dataSource.getRepository(Student);
    const student = await studentRepo.save({
      full_name: `Fine Trigger Student ${label}`,
      registration_number: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
      roll_number: Math.floor(Math.random() * 100000),
      class_section_id: sectionId,
      tenant_id: tenantId,
    });
    return student.id;
  }

  async function mark(
    ofTenantId: string,
    ofSectionId: string,
    studentId: string,
    date: string,
    status: AttendanceStatus,
    minutesLate: number | null = null,
  ): Promise<void> {
    const sessionRepo = dataSource.getRepository(AttendanceSession);
    const recordRepo = dataSource.getRepository(AttendanceRecord);
    let session = await sessionRepo.findOne({
      where: { tenant_id: ofTenantId, section_id: ofSectionId, date, period_no: IsNull() },
    });
    if (!session) {
      session = await sessionRepo.save({
        tenant_id: ofTenantId,
        section_id: ofSectionId,
        date,
        period_no: null,
        state: AttendanceSessionState.FINALIZED,
      });
    }
    await recordRepo.save({
      tenant_id: ofTenantId,
      session_id: session.id,
      student_id: studentId,
      date,
      status,
      minutes_late: minutesLate,
    });
  }

  describe('attendanceAbsentTrigger', () => {
    it('counts ABSENT days, excludes LEAVE and a forced non-working day', async () => {
      const studentId = await makeStudent('Absent1');
      await mark(tenantId, sectionId, studentId, '2026-09-01', AttendanceStatus.ABSENT);
      await mark(tenantId, sectionId, studentId, '2026-09-02', AttendanceStatus.ABSENT);
      // LEAVE must never be counted, even though it's inside the range.
      await mark(tenantId, sectionId, studentId, '2026-09-03', AttendanceStatus.LEAVE);
      // Forced non-working day (e.g. an ad-hoc holiday) — excluded via the
      // nonWorkingDates array, even though the record itself is ABSENT.
      await mark(tenantId, sectionId, studentId, '2026-09-04', AttendanceStatus.ABSENT);

      const result = await attendanceAbsentTrigger.count(
        dataSource.manager,
        tenantId,
        '2026-09-01',
        '2026-09-05',
        {},
        {},
        ['2026-09-04'],
      );

      expect(result.get(studentId)).toEqual({ count: 2, classId });
    });

    it("is invisible to another tenant's records", async () => {
      const otherSchool = await dataSource.getRepository(School).save({
        name: `Other Tenant ${Date.now()}`,
        slug: `other-tenant-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        settings: { version: 1 } as any,
      });
      const otherYear = await dataSource.getRepository(AcademicYear).save({
        name: 'Other Tenant Year',
        start_date: '2026-01-01',
        end_date: '2026-12-31',
        tenant_id: otherSchool.id,
      });
      const otherClass = await dataSource.getRepository(Class).save({
        name: 'Other Tenant Class',
        academic_year_id: otherYear.id,
        tenant_id: otherSchool.id,
      });
      const otherSection = await dataSource.getRepository(ClassSection).save({
        section_name: 'Other Section',
        class_id: otherClass.id,
        tenant_id: otherSchool.id,
      });
      const otherStudentId = await (async () => {
        const s = await dataSource.getRepository(Student).save({
          full_name: 'Other Tenant Student',
          registration_number: `OTHER-${Date.now()}`,
          roll_number: 999,
          class_section_id: otherSection.id,
          tenant_id: otherSchool.id,
        });
        return s.id;
      })();
      await mark(
        otherSchool.id,
        otherSection.id,
        otherStudentId,
        '2026-09-01',
        AttendanceStatus.ABSENT,
      );

      // Query scoped to the original tenant must not see the other
      // tenant's ABSENT record.
      const result = await attendanceAbsentTrigger.count(
        dataSource.manager,
        tenantId,
        '2026-09-01',
        '2026-09-05',
        {},
        {},
        [],
      );
      expect(result.has(otherStudentId)).toBe(false);
    });

    it("resolves a student moved mid-month to the latest record's class", async () => {
      const movedStudentId = await makeStudent('Moved');
      const classRepo = dataSource.getRepository(Class);
      const sectionRepo = dataSource.getRepository(ClassSection);
      const year = await dataSource
        .getRepository(AcademicYear)
        .findOneOrFail({ where: { tenant_id: tenantId } });
      const newClass = await classRepo.save({
        name: 'Fine Trigger Class B',
        academic_year_id: year.id,
        tenant_id: tenantId,
      });
      const newSection = await sectionRepo.save({
        section_name: 'FT Section B',
        class_id: newClass.id,
        tenant_id: tenantId,
      });

      // Absent in the old class first, then absent again in the new class
      // later in the range — the latest record's class must win.
      await mark(tenantId, sectionId, movedStudentId, '2026-10-01', AttendanceStatus.ABSENT);
      await mark(tenantId, newSection.id, movedStudentId, '2026-10-10', AttendanceStatus.ABSENT);

      const result = await attendanceAbsentTrigger.count(
        dataSource.manager,
        tenantId,
        '2026-10-01',
        '2026-10-15',
        {},
        {},
        [],
      );

      expect(result.get(movedStudentId)).toEqual({ count: 2, classId: newClass.id });
    });
  });

  describe('attendanceLateTrigger', () => {
    it('counts a LATE record with null minutes_late regardless of a min_minutes_late condition', async () => {
      const studentId = await makeStudent('LateNull');
      await mark(tenantId, sectionId, studentId, '2026-11-01', AttendanceStatus.LATE, null);

      const result = await attendanceLateTrigger.count(
        dataSource.manager,
        tenantId,
        '2026-11-01',
        '2026-11-05',
        { min_minutes_late: 10 },
        {},
        [],
      );

      expect(result.get(studentId)).toEqual({ count: 1, classId });
    });

    it('does not count a LATE record below the min_minutes_late threshold', async () => {
      const studentId = await makeStudent('LateBelow');
      await mark(tenantId, sectionId, studentId, '2026-11-02', AttendanceStatus.LATE, 5);

      const result = await attendanceLateTrigger.count(
        dataSource.manager,
        tenantId,
        '2026-11-01',
        '2026-11-05',
        { min_minutes_late: 10 },
        {},
        [],
      );

      expect(result.has(studentId)).toBe(false);
    });
  });

  describe('period registers are ignored (D1)', () => {
    async function markPeriods(
      studentId: string,
      date: string,
      status: AttendanceStatus,
    ): Promise<void> {
      for (const periodNo of [1, 2, 3]) {
        const sessionRepo = dataSource.getRepository(AttendanceSession);
        const where = {
          tenant_id: tenantId,
          section_id: sectionId,
          date: date,
          period_no: periodNo,
        };
        const session =
          (await sessionRepo.findOne({ where })) ??
          (await sessionRepo.save({
            tenant_id: tenantId,
            section_id: sectionId,
            date,
            period_no: periodNo,
            state: AttendanceSessionState.FINALIZED,
          }));
        await dataSource.getRepository(AttendanceRecord).save({
          tenant_id: tenantId,
          session_id: session.id,
          student_id: studentId,
          date,
          status,
          minutes_late: 30,
        });
      }
    }

    it('ATTENDANCE_ABSENT: absent in 3 periods but present for the day counts 0', async () => {
      const studentId = await makeStudent('PeriodAbsent');
      await mark(tenantId, sectionId, studentId, '2026-12-02', AttendanceStatus.PRESENT);
      await markPeriods(studentId, '2026-12-02', AttendanceStatus.ABSENT);

      const result = await attendanceAbsentTrigger.count(
        dataSource.manager,
        tenantId,
        '2026-12-01',
        '2026-12-05',
        {},
        {},
        [],
      );
      expect(result.has(studentId)).toBe(false);
    });

    it('ATTENDANCE_LATE: late in 3 periods but present for the day counts 0', async () => {
      const studentId = await makeStudent('PeriodLate');
      await mark(tenantId, sectionId, studentId, '2026-12-02', AttendanceStatus.PRESENT);
      await markPeriods(studentId, '2026-12-02', AttendanceStatus.LATE);

      const result = await attendanceLateTrigger.count(
        dataSource.manager,
        tenantId,
        '2026-12-01',
        '2026-12-05',
        {},
        {},
        [],
      );
      expect(result.has(studentId)).toBe(false);
    });
  });
});
