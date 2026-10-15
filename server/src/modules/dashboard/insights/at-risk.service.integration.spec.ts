import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ConfigModule } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { SEED_TENANT_ID } from '@test/constants';
import { enrollStudent } from '@test/helpers/enrollment.helper';
import { ensureFeeStructure } from '@test/helpers/fee-fixture.helper';
import { AttendanceStatus, DashboardRiskThresholds } from '@biddaloy/shared';
import { AttendanceModule } from '../../attendance/attendance.module';
import { AuthModule } from '../../auth/auth.module';
import { AttendanceSession } from '../../attendance/entities/attendance-session.entity';
import { AttendanceRecord } from '../../attendance/entities/attendance-record.entity';
import { AcademicYear } from '../../academics/entities/academic-year.entity';
import { Class } from '../../academics/entities/class.entity';
import { ClassSection } from '../../academics/entities/class-section.entity';
import { Student } from '../../students/entities/student.entity';
import { Enrollment } from '../../students/entities/enrollment.entity';
import { SchoolsService } from '../../schools/schools.service';
import { AtRiskService } from './at-risk.service';
import { DashboardInsightsModule } from './dashboard-insights.module';

const T: DashboardRiskThresholds = {
  absentStreakDays: 3,
  monthlyAttendancePct: 75,
  failedSubjects: 1,
  overdueDays: 60,
};

function addDays(dateIso: string, days: number): string {
  const d = new Date(`${dateIso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Real DB. Fixtures use their own current academic year so other suites' data never counts. */
describe('AtRiskService (integration)', () => {
  let service: AtRiskService;
  let dataSource: DataSource;
  let today: string;
  let yearId: string;
  let classId: string;
  let sectionId: string;
  let feeStructureId: string;
  let n = 0;

  beforeAll(async () => {
    const module = await createTestModule(
      ALL_ENTITIES,
      [],
      [
        ConfigModule.forRoot({ isGlobal: true }),
        AttendanceModule,
        AuthModule,
        DashboardInsightsModule,
      ],
    );
    service = module.get(AtRiskService);
    dataSource = module.get<DataSource>(getDataSourceToken());
    today = await module.get(SchoolsService).todayFor(SEED_TENANT_ID);

    await dataSource.query(`UPDATE academic_years SET is_current = false WHERE tenant_id = $1`, [
      SEED_TENANT_ID,
    ]);
    const year = await dataSource.getRepository(AcademicYear).save({
      name: `AtRisk Year ${Date.now()}`,
      start_date: '2020-01-01',
      end_date: '2099-12-31',
      is_current: true,
      tenant_id: SEED_TENANT_ID,
    });
    yearId = year.id;
    const klass = await dataSource
      .getRepository(Class)
      .save({ name: 'AtRisk Class', academic_year_id: yearId, tenant_id: SEED_TENANT_ID });
    classId = klass.id;
    sectionId = (
      await dataSource
        .getRepository(ClassSection)
        .save({ section_name: 'AtRisk A', class_id: classId, tenant_id: SEED_TENANT_ID })
    ).id;
  }, 60000);

  afterAll(async () => {
    if (dataSource) {
      await dataSource.query(`UPDATE academic_years SET is_current = false WHERE id = $1`, [
        yearId,
      ]);
      await dataSource.destroy();
    }
  });

  async function makeStudent(): Promise<string> {
    n += 1;
    const s = await dataSource.getRepository(Student).save({
      full_name: `Risk Student ${String(n).padStart(2, '0')}`,
      registration_number: `RISK-${n}-${Date.now()}`,
      roll_number: n,
      class_section_id: sectionId,
      tenant_id: SEED_TENANT_ID,
    });
    await enrollStudent(dataSource, s);
    // A real register marks everyone: start fully present, tests overwrite the days they need.
    await mark(s.id, 30, AttendanceStatus.PRESENT);
    return s.id;
  }

  /** Marks `status` on the last `days` days (today backwards), one register per day. */
  async function mark(studentId: string, days: number, status: AttendanceStatus): Promise<void> {
    for (let i = 0; i < days; i++) {
      const date = addDays(today, -i);
      await dataSource.query(
        `INSERT INTO attendance_sessions (tenant_id, section_id, date, period_no, state)
         VALUES ($1, $2, $3, NULL, 'FINALIZED') ON CONFLICT DO NOTHING`,
        [SEED_TENANT_ID, sectionId, date],
      );
      const [session] = await dataSource.getRepository(AttendanceSession).find({
        where: { tenant_id: SEED_TENANT_ID, section_id: sectionId, date },
      });
      await dataSource
        .getRepository(AttendanceRecord)
        .delete({ session_id: session.id, student_id: studentId });
      await dataSource.getRepository(AttendanceRecord).save({
        tenant_id: SEED_TENANT_ID,
        session_id: session.id,
        student_id: studentId,
        date,
        status,
      });
    }
  }

  async function bill(studentId: string, dueDate: string): Promise<void> {
    feeStructureId = await ensureFeeStructure(dataSource);
    await dataSource.query(
      `INSERT INTO student_fees
         (student_id, academic_year_id, fee_structure_id, period_start, period_type, occurrence,
          total_amount, paid_amount, status, due_date)
       VALUES ($1, $2, $3, $4, 'MONTH', 1, 1000, 0, 'PENDING', $5)`,
      [studentId, yearId, feeStructureId, `2026-01-${String(n).padStart(2, '0')}`, dueDate],
    );
  }

  /** One exam of the class with one result for the student and the given failing subjects. */
  async function exam(
    studentId: string,
    status: 'PUBLISHED' | 'PROCESSED',
    publishedAt: string,
    fails: Array<{ subject: string; fourth?: boolean }>,
    sameExamId?: string,
  ): Promise<string> {
    await dataSource.query(
      `INSERT INTO grading_scales (tenant_id, academic_year_id, name) VALUES ($1, $2, 'Test scale')
       ON CONFLICT DO NOTHING`,
      [SEED_TENANT_ID, yearId],
    );
    const [scale] = await dataSource.query(
      `SELECT id FROM grading_scales WHERE tenant_id = $1 AND academic_year_id = $2 LIMIT 1`,
      [SEED_TENANT_ID, yearId],
    );
    const [e] = sameExamId
      ? [{ id: sameExamId }]
      : await dataSource.query(
          `INSERT INTO exams (tenant_id, academic_year_id, class_id, name, kind, status, published_at)
       VALUES ($1, $2, $3, $4, 'TERM', $5, $6) RETURNING id`,
          [SEED_TENANT_ID, yearId, classId, `Exam ${randomUUID()}`, status, publishedAt],
        );
    const [r] = await dataSource.query(
      `INSERT INTO results (tenant_id, exam_id, student_id, total_marks, gpa, grade, is_fail,
          grading_scale_id, grading_scale_revision, rule_version, computed_at)
       VALUES ($1, $2, $3, 50, 1, 'F', true, $4, 1, 'v1', NOW()) RETURNING id`,
      [SEED_TENANT_ID, e.id, studentId, scale.id],
    );
    for (const f of fails) {
      const names = { MATH: ['Mathematics', 'গণিত'], SCI: ['Science', null] } as const;
      // Subjects are wiped between tests, so create on demand.
      const [sub] = await dataSource.query(
        `INSERT INTO subjects (tenant_id, code, name_en, name_bn) VALUES ($1, $2, $3, $4)
         ON CONFLICT DO NOTHING RETURNING id`,
        [SEED_TENANT_ID, f.subject, ...names[f.subject as 'MATH' | 'SCI']],
      );
      const subjectId =
        sub?.id ??
        (
          await dataSource.query(`SELECT id FROM subjects WHERE tenant_id = $1 AND code = $2`, [
            SEED_TENANT_ID,
            f.subject,
          ])
        )[0].id;
      await dataSource.query(
        `INSERT INTO result_subjects (tenant_id, result_id, subject_id, obtained, grade, gpa, is_fail, is_fourth_subject)
         VALUES ($1, $2, $3, 10, 'F', 0, true, $4)`,
        [SEED_TENANT_ID, r.id, subjectId, f.fourth ?? false],
      );
    }
    return e.id;
  }

  const find = async (id: string, t = T, date = today) =>
    (await service.compute(SEED_TENANT_ID, date, t)).find((s) => s.student_id === id);

  it('lists a student with an absent run and a 65-day overdue bill, with both signals', async () => {
    const id = await makeStudent();
    await mark(id, 4, AttendanceStatus.ABSENT);
    await bill(id, addDays(today, -65));
    const row = await find(id);
    expect(row?.signals.map((s) => s.kind).sort()).toEqual(
      expect.arrayContaining(['ABSENT_STREAK', 'OVERDUE']),
    );
    // Reconciles with the owner endpoints' numbers.
    expect(row?.signals.find((s) => s.kind === 'OVERDUE')?.value).toBe(65);
    expect(row?.signals.find((s) => s.kind === 'ABSENT_STREAK')?.value).toBe(4);
    expect(row?.class_name).toBe('AtRisk Class');
    expect(row?.section_name).toBe('AtRisk A');
  });

  it('does not list a student with only one signal', async () => {
    const id = await makeStudent();
    await bill(id, addDays(today, -90));
    expect(await find(id)).toBeUndefined();
  });

  it('overdue: 60 days counts, 59 does not (pairs with a failed subject as 2nd signal)', async () => {
    const at60 = await makeStudent();
    const at59 = await makeStudent();
    await bill(at60, addDays(today, -60));
    await bill(at59, addDays(today, -59));
    const examId = await exam(at60, 'PUBLISHED', '2026-01-03T00:00:00Z', [{ subject: 'MATH' }]);
    await exam(at59, 'PUBLISHED', '2026-01-03T00:00:00Z', [{ subject: 'MATH' }], examId);
    expect(await find(at60)).toBeDefined();
    expect(await find(at59)).toBeUndefined();
  });

  it("the day boundary follows the date passed in (Dhaka midnight is the caller's today)", async () => {
    const id = await makeStudent();
    await bill(id, '2026-08-08');
    await exam(id, 'PUBLISHED', '2026-01-03T00:00:00Z', [{ subject: 'MATH' }]);
    // Attendance threshold 0 keeps LOW_ATTENDANCE out of this date-boundary check.
    const t = { ...T, monthlyAttendancePct: 0 };
    expect(await find(id, t, '2026-10-06')).toBeUndefined(); // 59 days
    expect((await find(id, t, '2026-10-07'))?.signals.map((s) => s.kind)).toContain('OVERDUE'); // 60
  });

  it('failed subjects: fourth subject excluded, PROCESSED exam ignored, newest published wins', async () => {
    const fourthOnly = await makeStudent();
    const processed = await makeStudent();
    const older = await makeStudent();
    for (const id of [fourthOnly, processed, older]) await bill(id, addDays(today, -70));
    await exam(fourthOnly, 'PUBLISHED', '2026-02-01T00:00:00Z', [
      { subject: 'MATH', fourth: true },
    ]);
    await exam(processed, 'PROCESSED', '2026-02-01T00:00:00Z', [{ subject: 'MATH' }]);
    await exam(older, 'PUBLISHED', '2026-02-01T00:00:00Z', [{ subject: 'MATH' }]);
    // A newer published exam of the same class: `older` has no failed subject in it.
    await exam(older, 'PUBLISHED', '2026-05-01T00:00:00Z', []);
    expect(await find(fourthOnly)).toBeUndefined();
    expect(await find(processed)).toBeUndefined();
    expect(await find(older)).toBeUndefined();
  });

  it('applies school thresholds: failedSubjects 2 needs two failed subjects', async () => {
    const id = await makeStudent();
    await bill(id, addDays(today, -70));
    await exam(id, 'PUBLISHED', '2026-06-01T00:00:00Z', [{ subject: 'MATH' }, { subject: 'SCI' }]);
    const row = await find(id, { ...T, failedSubjects: 2 });
    const failed = row?.signals.find((s) => s.kind === 'FAILED_SUBJECTS');
    expect(failed?.value).toBe(2);
    expect(failed?.subjects?.map((s) => s.name_en)).toEqual(['Mathematics', 'Science']);
    expect(await find(id, { ...T, failedSubjects: 3 })).toBeUndefined();
  });

  it('a withdrawn student is not listed', async () => {
    const id = await makeStudent();
    await bill(id, addDays(today, -90));
    await mark(id, 5, AttendanceStatus.ABSENT);
    expect(await find(id)).toBeDefined();
    await dataSource
      .getRepository(Enrollment)
      .update({ student_id: id }, { enrollment_status: 'INACTIVE' as any });
    expect(await find(id)).toBeUndefined();
  });

  it("never returns another tenant's students", async () => {
    expect(await service.compute(randomUUID(), today, T)).toEqual([]);
  });
});
