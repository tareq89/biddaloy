import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Repository, DataSource } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ResultsService } from './results.service';
import { MarkGridService } from './mark-grid.service';
import { MarksService } from './marks.service';
import { Exam } from './entities/exam.entity';
import { ExamComponent } from './entities/exam-component.entity';
import { Mark } from './entities/mark.entity';
import { Result } from './entities/result.entity';
import { ExamSchedule } from './entities/exam-schedule.entity';
import { ResultSubject } from './entities/result-subject.entity';
import { ClassSubject } from '../academics/entities/class-subject.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { Subject } from '../academics/entities/subject.entity';
import { Student } from '../students/entities/student.entity';
import { Enrollment } from '../students/entities/enrollment.entity';
import { StudentSubjectChoice } from '../students/entities/student-subject-choice.entity';
import { GradingScale } from '../grading/entities/grading-scale.entity';
import { GradingBand } from '../grading/entities/grading-band.entity';
import { School } from '../schools/entities/school.entity';
import { Class } from '../academics/entities/class.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { AttendanceComponentService } from './attendance-component.service';
import { AuditService } from '../audit/audit.service';
import { MarksAuthorizationService } from './marks-authorization.util';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { SEED_ADMIN_USER_ID, SEED_TENANT_ID } from '@test/constants';
import {
  EnrollmentStatus,
  ExamComponentKind,
  ExamComponentSource,
  ExamKind,
  ExamStatus,
  MarkStatus,
  UserRole,
} from '@biddaloy/shared';

/**
 * [D17 / #994] Regression: `computeAll`'s cohort must come from `Enrollment`
 * (the exam's own academic_year_id + class_id), not `Student.class_section_id`
 * (the student's CURRENT placement) — otherwise reprocessing an old exam
 * after students have been promoted silently wipes its results.
 */

const TENANT_ID = SEED_TENANT_ID;
const YEAR_1_ID = '00000000-0000-4000-8000-0000000d0001';
const YEAR_2_ID = '00000000-0000-4000-8000-0000000d0002';
const CLASS_1_ID = '00000000-0000-4000-8000-0000000d0011';
const CLASS_2_ID = '00000000-0000-4000-8000-0000000d0012';
const SECTION_1_ID = '00000000-0000-4000-8000-0000000d0021';
const SECTION_2_ID = '00000000-0000-4000-8000-0000000d0022';
const SUBJECT_ID = '00000000-0000-4000-8000-0000000d0031';

// [D17 test isolation] `test/setup.ts`'s GLOBAL `beforeEach` (registered by
// vitest's `setupFiles`, so it runs before every `it()` in every spec file)
// truncates the full transactional table set on every test — including
// `subjects`, `class_subjects`, `grading_scales`, `grading_bands`,
// `exam_components`, `exams`, `enrollments`, `students`, `marks` (see
// `test/reset-order.ts`'s `TRANSACTIONAL_TABLES_CHILD_FIRST`). Only
// `schools`/`academic_years`/`classes`/`class_sections` are exempt (reset
// once per *file*, not per test). So `seedReferenceData` below — called
// once in `beforeAll` — only touches those four tables; everything else
// (subject/class_subject/grading scale+bands, and each test's own
// students/enrollments/exam/marks) is (re)created inside this file's own
// local `beforeEach`/`it()`, which run *after* the global one.
async function seedReferenceData(ds: DataSource): Promise<void> {
  await ds.query('DELETE FROM class_sections');
  await ds.query('DELETE FROM classes');
  await ds.query('DELETE FROM academic_years');
  await ds.query('DELETE FROM schools');

  const schoolRepo = ds.getRepository(School);
  const ayRepo = ds.getRepository(AcademicYear);
  const classRepo = ds.getRepository(Class);
  const sectionRepo = ds.getRepository(ClassSection);

  await schoolRepo.save(
    schoolRepo.create({
      id: TENANT_ID,
      name: 'Test School',
      slug: 'test-school',
      tenant_id: TENANT_ID,
    }),
  );

  await ayRepo.save(
    ayRepo.create({
      id: YEAR_1_ID,
      name: '2025-2026',
      start_date: new Date('2025-01-01'),
      end_date: new Date('2025-12-31'),
      is_current: false,
      tenant_id: TENANT_ID,
    }),
  );
  await ayRepo.save(
    ayRepo.create({
      id: YEAR_2_ID,
      name: '2026-2027',
      start_date: new Date('2026-01-01'),
      end_date: new Date('2026-12-31'),
      is_current: true,
      tenant_id: TENANT_ID,
    }),
  );

  await classRepo.save(
    classRepo.create({
      id: CLASS_1_ID,
      name: 'Class Five',
      academic_year_id: YEAR_1_ID,
      tenant_id: TENANT_ID,
    }),
  );
  await classRepo.save(
    classRepo.create({
      id: CLASS_2_ID,
      name: 'Class Six',
      academic_year_id: YEAR_2_ID,
      tenant_id: TENANT_ID,
    }),
  );
  await sectionRepo.save(
    sectionRepo.create({
      id: SECTION_1_ID,
      section_name: 'A',
      class_id: CLASS_1_ID,
      tenant_id: TENANT_ID,
    }),
  );
  await sectionRepo.save(
    sectionRepo.create({
      id: SECTION_2_ID,
      section_name: 'A',
      class_id: CLASS_2_ID,
      tenant_id: TENANT_ID,
    }),
  );
}

describe('ResultsService (integration, D17 — Enrollment-driven cohort)', () => {
  let resultsService: ResultsService;
  let markGridService: MarkGridService;
  let marksService: MarksService;
  let dataSource: DataSource;
  let studentRepo: Repository<Student>;
  let enrollmentRepo: Repository<Enrollment>;
  let examRepo: Repository<Exam>;
  let componentRepo: Repository<ExamComponent>;
  let markRepo: Repository<Mark>;
  let resultRepo: Repository<Result>;
  let subjectRepo: Repository<Subject>;
  let classSubjectRepo: Repository<ClassSubject>;
  let scaleRepo: Repository<GradingScale>;
  let bandRepo: Repository<GradingBand>;

  beforeAll(async () => {
    const stubAttendance = {
      computeForSection: async () => ({ reason: null, valuesByStudent: new Map() }),
    };
    const stubAudit = { record: async () => undefined, recordApproved: async () => undefined };
    const stubAuthz = {
      assertCanRead: async () => undefined,
      assertCanWrite: async () => undefined,
    };

    // ResultsService.process() is always called with force=true below, so
    // its own MarkGridService dependency's `.progress()` (the non-force
    // path) never fires — a real MarkGridService (also under test here for
    // getGrid) is used for both rather than a second stub.
    const module = await createTestModule(
      ALL_ENTITIES,
      [
        ResultsService,
        MarkGridService,
        MarksService,
        { provide: AttendanceComponentService, useValue: stubAttendance },
        { provide: AuditService, useValue: stubAudit },
        { provide: MarksAuthorizationService, useValue: stubAuthz },
      ],
      [],
      { synchronize: true, dropSchema: true },
    );

    resultsService = module.get(ResultsService);
    markGridService = module.get(MarkGridService);
    marksService = module.get(MarksService);
    dataSource = module.get(DataSource);
    studentRepo = module.get(getRepositoryToken(Student));
    enrollmentRepo = module.get(getRepositoryToken(Enrollment));
    examRepo = module.get(getRepositoryToken(Exam));
    componentRepo = module.get(getRepositoryToken(ExamComponent));
    markRepo = module.get(getRepositoryToken(Mark));
    resultRepo = module.get(getRepositoryToken(Result));
    subjectRepo = module.get(getRepositoryToken(Subject));
    classSubjectRepo = module.get(getRepositoryToken(ClassSubject));
    scaleRepo = module.get(getRepositoryToken(GradingScale));
    bandRepo = module.get(getRepositoryToken(GradingBand));

    await seedReferenceData(dataSource);
  }, 60000);

  afterAll(async () => {
    if (dataSource) {
      await dataSource.destroy();
    }
  });

  // Re-seeds everything the global `beforeEach` (test/setup.ts) just wiped —
  // see the comment on `seedReferenceData` above for why this can't live in
  // the one-time `beforeAll` instead.
  beforeEach(async () => {
    await subjectRepo.save(
      subjectRepo.create({
        id: SUBJECT_ID,
        name_en: 'Mathematics',
        code: 'MATH',
        tenant_id: TENANT_ID,
      }),
    );
    await classSubjectRepo.save(
      classSubjectRepo.create({
        class_id: CLASS_1_ID,
        subject_id: SUBJECT_ID,
        academic_year_id: YEAR_1_ID,
        is_optional: false,
        is_graded_only: false,
        tenant_id: TENANT_ID,
      }),
    );
    const scale = await scaleRepo.save(
      scaleRepo.create({
        tenant_id: TENANT_ID,
        academic_year_id: YEAR_1_ID,
        class_id: null,
        name: 'NCTB',
        revision: 1,
      }),
    );
    await bandRepo.save([
      bandRepo.create({
        tenant_id: TENANT_ID,
        scale_id: scale.id,
        percent_from: 33,
        percent_to: 100,
        grade: 'PASS',
        gpa: '5.00',
        is_fail: false,
        sequence: 1,
      }),
      bandRepo.create({
        tenant_id: TENANT_ID,
        scale_id: scale.id,
        percent_from: 0,
        percent_to: 32,
        grade: 'FAIL',
        gpa: '0.00',
        is_fail: true,
        sequence: 2,
      }),
    ]);
  });

  async function buildStudent(overrides: Partial<Student> = {}): Promise<Student> {
    return studentRepo.save(
      studentRepo.create({
        full_name: 'Test Student',
        registration_number: `REG-${Math.random()}`,
        roll_number: 1,
        class_section_id: SECTION_1_ID,
        tenant_id: TENANT_ID,
        date_of_birth: new Date('2012-01-01'),
        gender: 'MALE',
        enrollment_status: EnrollmentStatus.ACTIVE,
        preferred_communication: 'SMS',
        ...overrides,
      }),
    );
  }

  it('reprocessing an old exam after promotion keeps both students’ results with the same totals', async () => {
    const student1 = await buildStudent({ roll_number: 1 });
    const student2 = await buildStudent({
      roll_number: 2,
      registration_number: `REG-${Math.random()}`,
    });

    await enrollmentRepo.save([
      enrollmentRepo.create({
        student_id: student1.id,
        class_id: CLASS_1_ID,
        section_id: SECTION_1_ID,
        academic_year_id: YEAR_1_ID,
        enrollment_status: EnrollmentStatus.ACTIVE,
        tenant_id: TENANT_ID,
      }),
      enrollmentRepo.create({
        student_id: student2.id,
        class_id: CLASS_1_ID,
        section_id: SECTION_1_ID,
        academic_year_id: YEAR_1_ID,
        enrollment_status: EnrollmentStatus.ACTIVE,
        tenant_id: TENANT_ID,
      }),
    ]);

    const exam = await examRepo.save(
      examRepo.create({
        tenant_id: TENANT_ID,
        academic_year_id: YEAR_1_ID,
        class_id: CLASS_1_ID,
        name: 'First Term Exam',
        kind: ExamKind.TERM,
        status: ExamStatus.DRAFT,
      }),
    );
    const component = await componentRepo.save(
      componentRepo.create({
        tenant_id: TENANT_ID,
        exam_id: exam.id,
        subject_id: SUBJECT_ID,
        name: 'Written',
        kind: ExamComponentKind.WRITTEN,
        source: ExamComponentSource.MANUAL,
        full_marks: '100',
        sequence: 1,
      }),
    );
    await markRepo.save([
      markRepo.create({
        tenant_id: TENANT_ID,
        exam_id: exam.id,
        student_id: student1.id,
        subject_id: SUBJECT_ID,
        component_id: component.id,
        value: '85.00',
        status: MarkStatus.PRESENT,
      }),
      markRepo.create({
        tenant_id: TENANT_ID,
        exam_id: exam.id,
        student_id: student2.id,
        subject_id: SUBJECT_ID,
        component_id: component.id,
        value: '40.00',
        status: MarkStatus.PRESENT,
      }),
    ]);

    // First process — both students still hold their original placement.
    const first = await resultsService.process(exam.id, TENANT_ID, 'user-1', true);
    expect(first.processed).toBe(2);

    const firstResults = await resultRepo.find({
      where: { exam_id: exam.id, tenant_id: TENANT_ID },
    });
    const firstByStudent = new Map(firstResults.map((r) => [r.student_id, r]));
    expect(firstByStudent.get(student1.id)?.total_marks).toBe('85.00');
    expect(firstByStudent.get(student2.id)?.total_marks).toBe('40.00');

    // Promotion: both students' CURRENT placement moves to a different
    // year's class+section, and they get a fresh ACTIVE enrollment for
    // that new year — the old year-1 enrollment stays ACTIVE too (the
    // unique-active-enrollment index is scoped per academic_year_id).
    await studentRepo.update(student1.id, { class_section_id: SECTION_2_ID });
    await studentRepo.update(student2.id, { class_section_id: SECTION_2_ID });
    await enrollmentRepo.save([
      enrollmentRepo.create({
        student_id: student1.id,
        class_id: CLASS_2_ID,
        section_id: SECTION_2_ID,
        academic_year_id: YEAR_2_ID,
        enrollment_status: EnrollmentStatus.ACTIVE,
        tenant_id: TENANT_ID,
      }),
      enrollmentRepo.create({
        student_id: student2.id,
        class_id: CLASS_2_ID,
        section_id: SECTION_2_ID,
        academic_year_id: YEAR_2_ID,
        enrollment_status: EnrollmentStatus.ACTIVE,
        tenant_id: TENANT_ID,
      }),
    ]);

    // Reprocess the OLD (year-1) exam. Before D17, this re-derived the
    // cohort from Student.class_section_id (now SECTION_2_ID, a different
    // year's section) and found nobody — wiping both results.
    const second = await resultsService.process(exam.id, TENANT_ID, 'user-1', true);
    expect(second.processed).toBe(2);

    const secondResults = await resultRepo.find({
      where: { exam_id: exam.id, tenant_id: TENANT_ID },
    });
    expect(secondResults).toHaveLength(2);
    const secondByStudent = new Map(secondResults.map((r) => [r.student_id, r]));
    expect(secondByStudent.get(student1.id)?.total_marks).toBe('85.00');
    expect(secondByStudent.get(student2.id)?.total_marks).toBe('40.00');
  });

  it('a student whose Student.class_section_id points elsewhere still appears in the mark grid, keyed by Enrollment', async () => {
    const student = await buildStudent({
      roll_number: 5,
      // CURRENT placement points at a different year's section — only the
      // ACTIVE enrollment below should decide who is on this grid.
      class_section_id: SECTION_2_ID,
    });

    await enrollmentRepo.save(
      enrollmentRepo.create({
        student_id: student.id,
        class_id: CLASS_1_ID,
        section_id: SECTION_1_ID,
        academic_year_id: YEAR_1_ID,
        enrollment_status: EnrollmentStatus.ACTIVE,
        tenant_id: TENANT_ID,
      }),
    );

    const exam = await examRepo.save(
      examRepo.create({
        tenant_id: TENANT_ID,
        academic_year_id: YEAR_1_ID,
        class_id: CLASS_1_ID,
        name: 'Monthly Test',
        kind: ExamKind.MONTHLY,
        status: ExamStatus.DRAFT,
      }),
    );
    await componentRepo.save(
      componentRepo.create({
        tenant_id: TENANT_ID,
        exam_id: exam.id,
        subject_id: SUBJECT_ID,
        name: 'Written',
        kind: ExamComponentKind.WRITTEN,
        source: ExamComponentSource.MANUAL,
        full_marks: '100',
        sequence: 1,
      }),
    );

    const grid = await markGridService.getGrid(
      exam.id,
      SECTION_1_ID,
      SUBJECT_ID,
      TENANT_ID,
      UserRole.ADMIN,
      'user-1',
    );

    expect(grid.students.map((s) => s.id)).toEqual([student.id]);
  });

  // ---- [68.1.07] LIFE-01 / ACAD-03 / ACAD-06: the cohort is "who sat it" ----

  /** Builds a processed exam for students A, B (+ optional extras), then
   * returns handles. Marks: A=85, B=40. */
  async function processedExamWithAB(
    beforeProcess?: (ctx: {
      a: Student;
      b: Student;
      exam: Exam;
      addMark: (studentId: string, value: string) => Promise<Mark>;
      enroll: (studentId: string) => Promise<Enrollment>;
    }) => Promise<void>,
  ) {
    const a = await buildStudent({ roll_number: 1 });
    const b = await buildStudent({ roll_number: 2 });
    await enrollmentRepo.save(
      [a, b].map((st) =>
        enrollmentRepo.create({
          student_id: st.id,
          class_id: CLASS_1_ID,
          section_id: SECTION_1_ID,
          academic_year_id: YEAR_1_ID,
          enrollment_status: EnrollmentStatus.ACTIVE,
          tenant_id: TENANT_ID,
        }),
      ),
    );
    const exam = await examRepo.save(
      examRepo.create({
        tenant_id: TENANT_ID,
        academic_year_id: YEAR_1_ID,
        class_id: CLASS_1_ID,
        name: 'Cohort Exam',
        kind: ExamKind.TERM,
        status: ExamStatus.DRAFT,
      }),
    );
    const component = await componentRepo.save(
      componentRepo.create({
        tenant_id: TENANT_ID,
        exam_id: exam.id,
        subject_id: SUBJECT_ID,
        name: 'Written',
        kind: ExamComponentKind.WRITTEN,
        source: ExamComponentSource.MANUAL,
        full_marks: '100',
        sequence: 1,
      }),
    );
    const addMark = (studentId: string, value: string) =>
      markRepo.save(
        markRepo.create({
          tenant_id: TENANT_ID,
          exam_id: exam.id,
          student_id: studentId,
          subject_id: SUBJECT_ID,
          component_id: component.id,
          value,
          status: MarkStatus.PRESENT,
        }),
      );
    await addMark(a.id, '85.00');
    await addMark(b.id, '40.00');
    const enroll = (studentId: string) =>
      enrollmentRepo.save(
        enrollmentRepo.create({
          student_id: studentId,
          class_id: CLASS_1_ID,
          section_id: SECTION_1_ID,
          academic_year_id: YEAR_1_ID,
          enrollment_status: EnrollmentStatus.ACTIVE,
          tenant_id: TENANT_ID,
        }),
      );
    const ctx = { a, b, exam, component, addMark, enroll };
    // Runs before the first process, e.g. to add a third student.
    await beforeProcess?.(ctx);
    await resultsService.process(exam.id, TENANT_ID, 'user-1', true);
    return ctx;
  }

  /** Class positions of the live rows must be 1..n with no gaps or repeats. */
  function expectContiguousPositions(rows: Result[]) {
    const positions = rows.map((r) => r.position).sort((x, y) => Number(x) - Number(y));
    expect(positions).toEqual(rows.map((_, i) => i + 1));
  }

  const liveResults = (examId: string) =>
    resultRepo.find({ where: { exam_id: examId, tenant_id: TENANT_ID } });

  it.each([EnrollmentStatus.TRANSFERRED, EnrollmentStatus.GRADUATED, EnrollmentStatus.INACTIVE])(
    'LIFE-01: a student who became %s keeps their result when the exam is reprocessed',
    async (status) => {
      const { a, b, exam } = await processedExamWithAB();
      await enrollmentRepo.update({ student_id: a.id }, { enrollment_status: status });

      const out = await resultsService.process(exam.id, TENANT_ID, 'user-1', true);
      // A is no longer ACTIVE but sat the exam: still recomputed.
      expect(out.processed).toBe(2);

      const rows = await liveResults(exam.id);
      const byStudent = new Map(rows.map((r) => [r.student_id, r]));
      expect(rows).toHaveLength(2);
      expect(byStudent.get(a.id)?.total_marks).toBe('85.00');
      // Ranked together: no duplicate positions.
      expect(byStudent.get(a.id)?.position).toBe(1);
      expect(byStudent.get(b.id)?.position).toBe(2);
    },
  );

  it('ACAD-06: a student admitted after the last sitting with no marks gets no result', async () => {
    const { exam, a } = await processedExamWithAB();
    const subjectId = SUBJECT_ID;
    await dataSource.getRepository(ExamSchedule).save({
      tenant_id: TENANT_ID,
      exam_id: exam.id,
      subject_id: subjectId,
      date: '2025-03-01',
      starts_at: '10:00',
      ends_at: '12:00',
    });
    const late = await buildStudent({ roll_number: 3 });
    await enrollmentRepo.save(
      enrollmentRepo.create({
        student_id: late.id,
        class_id: CLASS_1_ID,
        section_id: SECTION_1_ID,
        academic_year_id: YEAR_1_ID,
        enrollment_status: EnrollmentStatus.ACTIVE,
        enrolled_at: new Date('2025-06-01T00:00:00Z'),
        tenant_id: TENANT_ID,
      }),
    );

    await resultsService.process(exam.id, TENANT_ID, 'user-1', true);
    const rows = await liveResults(exam.id);
    expect(rows.map((r) => r.student_id)).not.toContain(late.id);
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.student_id === a.id)?.position).toBe(1);
  });

  it('ACAD-06: the same late student WITH a mark does get a result', async () => {
    const { exam, addMark } = await processedExamWithAB();
    await dataSource.getRepository(ExamSchedule).save({
      tenant_id: TENANT_ID,
      exam_id: exam.id,
      subject_id: SUBJECT_ID,
      date: '2025-03-01',
      starts_at: '10:00',
      ends_at: '12:00',
    });
    const late = await buildStudent({ roll_number: 3 });
    await enrollmentRepo.save(
      enrollmentRepo.create({
        student_id: late.id,
        class_id: CLASS_1_ID,
        section_id: SECTION_1_ID,
        academic_year_id: YEAR_1_ID,
        enrollment_status: EnrollmentStatus.ACTIVE,
        enrolled_at: new Date('2025-06-01T00:00:00Z'),
        tenant_id: TENANT_ID,
      }),
    );
    await addMark(late.id, '70.00');

    await resultsService.process(exam.id, TENANT_ID, 'user-1', true);
    const rows = await liveResults(exam.id);
    expect(rows.map((r) => r.student_id)).toContain(late.id);
  });

  it('a soft-deleted student who had a result keeps it; one with none gets none', async () => {
    const { a, exam } = await processedExamWithAB();
    await studentRepo.softDelete(a.id);
    // A deleted duplicate that never had a result or marks.
    const ghost = await buildStudent({ roll_number: 9 });
    await enrollmentRepo.save(
      enrollmentRepo.create({
        student_id: ghost.id,
        class_id: CLASS_1_ID,
        section_id: SECTION_1_ID,
        academic_year_id: YEAR_1_ID,
        enrollment_status: EnrollmentStatus.ACTIVE,
        tenant_id: TENANT_ID,
      }),
    );
    await studentRepo.softDelete(ghost.id);

    await resultsService.process(exam.id, TENANT_ID, 'user-1', true);
    const ids = (await liveResults(exam.id)).map((r) => r.student_id);
    expect(ids).toContain(a.id);
    expect(ids).not.toContain(ghost.id);
  });

  // ---- [#2215 review round 1] existing exams converge to the real cohort ----

  /** A results row as an older process would have written it. */
  async function oldResultRow(
    examId: string,
    studentId: string,
    position: number,
    tenantId = TENANT_ID,
  ): Promise<Result> {
    const scale = await scaleRepo.findOneByOrFail({ tenant_id: TENANT_ID });
    return resultRepo.save(
      resultRepo.create({
        exam_id: examId,
        student_id: studentId,
        total_marks: '0.00',
        gpa: '0.00',
        grade: 'FAIL',
        position,
        section_id: SECTION_1_ID,
        is_fail: true,
        grading_scale_id: scale.id,
        grading_scale_revision: 1,
        rule_version: 'nctb-v1',
        computed_at: new Date(),
        tenant_id: tenantId,
      }),
    );
  }

  // [68.1.fix F1] enrolled_at is not a reliable join date (the 1789800015000
  // backfill and every mid-year import stamp now()), so a row that already
  // exists is never removed on its say-so: that would drop real absentees.
  it('M1: an existing late-joiner FAIL row (written before #2215) is kept on reprocess', async () => {
    const { exam, a, b } = await processedExamWithAB();
    await dataSource.getRepository(ExamSchedule).save({
      tenant_id: TENANT_ID,
      exam_id: exam.id,
      subject_id: SUBJECT_ID,
      date: '2025-03-01',
      starts_at: '10:00',
      ends_at: '12:00',
    });
    const late = await buildStudent({ roll_number: 3 });
    await enrollmentRepo.save(
      enrollmentRepo.create({
        student_id: late.id,
        class_id: CLASS_1_ID,
        section_id: SECTION_1_ID,
        academic_year_id: YEAR_1_ID,
        enrollment_status: EnrollmentStatus.ACTIVE,
        enrolled_at: new Date('2025-06-01T00:00:00Z'),
        tenant_id: TENANT_ID,
      }),
    );
    // Old data: the late joiner was auto-failed — here even holding position 1.
    await oldResultRow(exam.id, late.id, 1);

    await resultsService.process(exam.id, TENANT_ID, 'user-1', true);

    const rows = await liveResults(exam.id);
    expect(rows.map((r) => r.student_id).sort()).toEqual([a.id, b.id, late.id].sort());
    // A failed result takes no position, so the ranked students stay 1..n.
    expect(rows.find((r) => r.student_id === late.id)?.position).toBeNull();
    expectContiguousPositions(rows.filter((r) => r.student_id !== late.id));
  });

  it('F1: an absentee whose enrolled_at was backfilled after the exam keeps their result on reprocess', async () => {
    let absentId = '';
    const { exam } = await processedExamWithAB(async ({ enroll }) => {
      // Sat nothing: no Mark rows, so the first process writes ABS/FAIL.
      const absent = await buildStudent({ roll_number: 3 });
      absentId = absent.id;
      await enroll(absent.id);
    });
    const before = (await liveResults(exam.id)).find((r) => r.student_id === absentId);
    expect(before?.is_fail).toBe(true);

    // The sitting date becomes known (March) and the enrollment looks like a
    // June join, as BackfillMissingEnrollments left it (enrolled_at = now()).
    await dataSource.getRepository(ExamSchedule).save({
      tenant_id: TENANT_ID,
      exam_id: exam.id,
      subject_id: SUBJECT_ID,
      date: '2025-03-01',
      starts_at: '10:00',
      ends_at: '12:00',
    });
    await enrollmentRepo.update({ student_id: absentId }, { enrolled_at: new Date() });

    await resultsService.process(exam.id, TENANT_ID, 'user-1', true);

    const rows = await liveResults(exam.id);
    expect(rows).toHaveLength(3);
    const after = rows.find((r) => r.student_id === absentId);
    expect(after?.is_fail).toBe(true);
    expect(after?.grade).toBe(before?.grade);
    expect(after?.position).toBe(before?.position);
  });

  it('M1: a student moved to another class in place is recomputed in their old section, with no duplicate position', async () => {
    let movedId = '';
    const { exam, b } = await processedExamWithAB(async ({ addMark, enroll }) => {
      const moved = await buildStudent({ roll_number: 3, full_name: 'Moved Student' });
      movedId = moved.id;
      await enroll(moved.id);
      await addMark(moved.id, '60.00');
    });
    // A=85, moved=60, B=40.
    expect((await liveResults(exam.id)).find((r) => r.student_id === movedId)?.position).toBe(2);

    // enrollments.service moves a student by updating class_id in place, so
    // no enrollment for this exam's class/year is left.
    await enrollmentRepo.update(
      { student_id: movedId },
      { class_id: CLASS_2_ID, section_id: SECTION_2_ID },
    );

    // The real trigger: a mark edit on a PROCESSED exam.
    await resultsService.recomputeIfProcessed(exam.id, [b.id], TENANT_ID, 'user-1');

    const rows = await liveResults(exam.id);
    expect(rows).toHaveLength(3);
    const moved = rows.find((r) => r.student_id === movedId)!;
    expect(moved.total_marks).toBe('60.00');
    // The section comes from their existing result, not their new class.
    expect(moved.section_id).toBe(SECTION_1_ID);
    expect(moved.position).toBe(2);
    expectContiguousPositions(rows);
  });

  it('M1: a student who left but has marks is kept on a mark-edit recompute, positions contiguous', async () => {
    const { exam, a, b } = await processedExamWithAB();
    await enrollmentRepo.update(
      { student_id: a.id },
      { enrollment_status: EnrollmentStatus.TRANSFERRED },
    );

    await resultsService.recomputeIfProcessed(exam.id, [b.id], TENANT_ID, 'user-1');

    const rows = await liveResults(exam.id);
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.student_id === a.id)?.total_marks).toBe('85.00');
    expectContiguousPositions(rows);
  });

  it('m1: wrongly enrolled, auto-failed, then INACTIVE with no marks is dropped; INACTIVE with marks is kept', async () => {
    let wrongId = '';
    const { exam, a, b } = await processedExamWithAB(async ({ enroll }) => {
      const wrong = await buildStudent({ roll_number: 4 });
      wrongId = wrong.id;
      await enroll(wrong.id);
    });
    // The first process auto-failed the wrongly enrolled student (no marks).
    expect((await liveResults(exam.id)).map((r) => r.student_id)).toContain(wrongId);

    await enrollmentRepo.update(
      { student_id: wrongId },
      { enrollment_status: EnrollmentStatus.INACTIVE },
    );
    await enrollmentRepo.update(
      { student_id: a.id },
      { enrollment_status: EnrollmentStatus.INACTIVE },
    );

    await resultsService.process(exam.id, TENANT_ID, 'user-1', true);

    const rows = await liveResults(exam.id);
    // A Result alone is not proof of sitting: no marks, no result.
    expect(rows.map((r) => r.student_id).sort()).toEqual([a.id, b.id].sort());
    expect(rows.find((r) => r.student_id === a.id)?.total_marks).toBe('85.00');
    expectContiguousPositions(rows);
  });

  it('m7: no schedule and no term — a student enrolled after the first mark entry needs marks of their own', async () => {
    const { exam, addMark, enroll } = await processedExamWithAB();
    // Marks were entered a month ago, so the sitting was on or before that day.
    await dataSource.query(
      `UPDATE marks SET created_at = now() - interval '30 days' WHERE exam_id = $1`,
      [exam.id],
    );
    const lateNoMarks = await buildStudent({ roll_number: 5 });
    const lateWithMarks = await buildStudent({ roll_number: 6 });
    await enroll(lateNoMarks.id);
    await enroll(lateWithMarks.id);
    await addMark(lateWithMarks.id, '50.00');

    await resultsService.process(exam.id, TENANT_ID, 'user-1', true);

    const ids = (await liveResults(exam.id)).map((r) => r.student_id);
    expect(ids).not.toContain(lateNoMarks.id);
    expect(ids).toContain(lateWithMarks.id);
  });

  it('F2: re-saving marks does not move the fallback sitting date later', async () => {
    const { exam, enroll } = await processedExamWithAB();
    // First entered 30 days ago, then re-saved today (a grid re-save bumps updated_at only).
    await dataSource.query(
      `UPDATE marks SET created_at = now() - interval '30 days', updated_at = now() WHERE exam_id = $1`,
      [exam.id],
    );
    // Joined 10 days ago: after the first mark entry, so after the sitting.
    const late = await buildStudent({ roll_number: 5 });
    await enroll(late.id);
    await enrollmentRepo.update(
      { student_id: late.id },
      { enrolled_at: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000) },
    );

    await resultsService.process(exam.id, TENANT_ID, 'user-1', true);

    const ids = (await liveResults(exam.id)).map((r) => r.student_id);
    expect(ids).not.toContain(late.id);
  });

  it('m2: a student who left with a choice-group pick does not trigger CHOICE_GROUP_UNPICKED on reprocess', async () => {
    const ELECTIVE_ID = '00000000-0000-4000-8000-0000000d0033';
    await subjectRepo.save(
      subjectRepo.create({
        id: ELECTIVE_ID,
        name_en: 'Agriculture',
        code: 'AGRI',
        tenant_id: TENANT_ID,
      }),
    );
    const elective = await classSubjectRepo.save(
      classSubjectRepo.create({
        class_id: CLASS_1_ID,
        subject_id: ELECTIVE_ID,
        academic_year_id: YEAR_1_ID,
        is_optional: false,
        is_graded_only: false,
        choice_group: 'ELECTIVE',
        tenant_id: TENANT_ID,
      }),
    );
    const choiceRepo = dataSource.getRepository(StudentSubjectChoice);
    const { exam, a } = await processedExamWithAB(async (ctx) => {
      const comp = await componentRepo.save(
        componentRepo.create({
          tenant_id: TENANT_ID,
          exam_id: ctx.exam.id,
          subject_id: ELECTIVE_ID,
          name: 'Written',
          kind: ExamComponentKind.WRITTEN,
          source: ExamComponentSource.MANUAL,
          full_marks: '100',
          sequence: 2,
        }),
      );
      for (const st of [ctx.a, ctx.b]) {
        await choiceRepo.save(
          choiceRepo.create({
            student_id: st.id,
            class_subject_id: elective.id,
            academic_year_id: YEAR_1_ID,
            tenant_id: TENANT_ID,
          }),
        );
        await markRepo.save(
          markRepo.create({
            tenant_id: TENANT_ID,
            exam_id: ctx.exam.id,
            student_id: st.id,
            subject_id: ELECTIVE_ID,
            component_id: comp.id,
            value: '70.00',
            status: MarkStatus.PRESENT,
          }),
        );
      }
    });
    await enrollmentRepo.update(
      { student_id: a.id },
      { enrollment_status: EnrollmentStatus.TRANSFERRED },
    );

    // D44 is not bypassable by force: this would 409 if A had lost their pick.
    await expect(resultsService.process(exam.id, TENANT_ID, 'user-1', true)).resolves.toEqual({
      processed: 2,
    });
    const rows = await liveResults(exam.id);
    // Math 85 + Agriculture 70.
    expect(rows.find((r) => r.student_id === a.id)?.total_marks).toBe('155.00');
  });

  it('m3: tenant isolation — processing tenant A never reads or touches tenant B rows of the same shape', async () => {
    const OTHER_TENANT_ID = '00000000-0000-4000-8000-0000000d00be';
    await dataSource.getRepository(School).save({
      id: OTHER_TENANT_ID,
      name: 'Other School',
      slug: 'other-school-d17',
      tenant_id: OTHER_TENANT_ID,
    });
    const { exam, a, b, component } = await processedExamWithAB();

    // Tenant B rows sharing every id a missing tenant filter would match on:
    // the same exam id, component, year, class and section.
    const other = await buildStudent({ roll_number: 7, tenant_id: OTHER_TENANT_ID });
    await enrollmentRepo.save(
      enrollmentRepo.create({
        student_id: other.id,
        class_id: CLASS_1_ID,
        section_id: SECTION_1_ID,
        academic_year_id: YEAR_1_ID,
        enrollment_status: EnrollmentStatus.ACTIVE,
        tenant_id: OTHER_TENANT_ID,
      }),
    );
    await markRepo.save(
      markRepo.create({
        tenant_id: OTHER_TENANT_ID,
        exam_id: exam.id,
        student_id: other.id,
        subject_id: SUBJECT_ID,
        component_id: component.id,
        value: '99.00',
        status: MarkStatus.PRESENT,
      }),
    );
    const otherRow = await oldResultRow(exam.id, other.id, 1, OTHER_TENANT_ID);

    const out = await resultsService.process(exam.id, TENANT_ID, 'user-1', true);
    expect(out.processed).toBe(2);

    // Tenant A: exactly its own two students, ranked 1..2.
    const tenantA = await resultRepo.find({ where: { exam_id: exam.id, tenant_id: TENANT_ID } });
    expect(tenantA.map((r) => r.student_id).sort()).toEqual([a.id, b.id].sort());
    expectContiguousPositions(tenantA);

    // Tenant B: its one row is untouched — still live, same values.
    const tenantB = await resultRepo.find({
      where: { exam_id: exam.id, tenant_id: OTHER_TENANT_ID },
    });
    expect(tenantB).toHaveLength(1);
    expect(tenantB[0]).toMatchObject({ id: otherRow.id, total_marks: '0.00', position: 1 });
  });

  // ACAD-01 / ACAD-04 (part): a component below its own pass mark fails the
  // subject even when the 100-mark total clears the pass band.
  async function buildPhysicsExam(scores: Array<string | null>) {
    const student = await buildStudent({ roll_number: 41 });
    await enrollmentRepo.save(
      enrollmentRepo.create({
        student_id: student.id,
        class_id: CLASS_1_ID,
        section_id: SECTION_1_ID,
        academic_year_id: YEAR_1_ID,
        enrollment_status: EnrollmentStatus.ACTIVE,
        tenant_id: TENANT_ID,
      }),
    );
    const exam = await examRepo.save(
      examRepo.create({
        tenant_id: TENANT_ID,
        academic_year_id: YEAR_1_ID,
        class_id: CLASS_1_ID,
        name: 'Physics Term',
        kind: ExamKind.TERM,
        status: ExamStatus.DRAFT,
      }),
    );
    const defs: Array<[string, ExamComponentKind, string, string]> = [
      ['MCQ', ExamComponentKind.MCQ, '25', '8'],
      ['Written', ExamComponentKind.WRITTEN, '50', '17'],
      ['Practical', ExamComponentKind.PRACTICAL, '25', '8'],
    ];
    const components: ExamComponent[] = [];
    for (const [i, [name, kind, full, pass]] of defs.entries()) {
      components.push(
        await componentRepo.save(
          componentRepo.create({
            tenant_id: TENANT_ID,
            exam_id: exam.id,
            subject_id: SUBJECT_ID,
            name,
            kind,
            source: ExamComponentSource.MANUAL,
            full_marks: full,
            pass_marks: pass,
            sequence: i + 1,
          }),
        ),
      );
    }
    for (const [i, c] of components.entries()) {
      const value = scores[i];
      await markRepo.save(
        markRepo.create({
          tenant_id: TENANT_ID,
          exam_id: exam.id,
          student_id: student.id,
          subject_id: SUBJECT_ID,
          component_id: c.id,
          value,
          status: MarkStatus.PRESENT,
        }),
      );
    }
    return { exam, student };
  }

  it('ACAD-01: MCQ 3/25 (pass 8) fails the subject and the result although the total is 68/100', async () => {
    const { exam, student } = await buildPhysicsExam(['3.00', '45.00', '20.00']);

    await resultsService.process(exam.id, TENANT_ID, 'user-1', true);

    const result = await resultRepo.findOneByOrFail({ exam_id: exam.id, student_id: student.id });
    expect(result.is_fail).toBe(true);
    expect(result.total_marks).toBe('68.00');
    expect(result.rule_version).toBe('nctb-v3');
    const subjects = await dataSource
      .getRepository(ResultSubject)
      .find({ where: { result_id: result.id } });
    expect(subjects).toHaveLength(1);
    expect(subjects[0].is_fail).toBe(true);
    // The fixture scale has a FAIL band at 0-32; component-fail uses it.
    expect(subjects[0].grade).toBe('FAIL');
  });

  it('ACAD-01: a student exactly at every pass mark passes', async () => {
    const { exam, student } = await buildPhysicsExam(['8.00', '17.00', '8.00']);

    await resultsService.process(exam.id, TENANT_ID, 'user-1', true);

    const result = await resultRepo.findOneByOrFail({ exam_id: exam.id, student_id: student.id });
    expect(result.is_fail).toBe(false);
  });

  it('ACAD-04: a cleared cell (PRESENT, no value) is graded ABS, never a silent 0', async () => {
    const { exam, student } = await buildPhysicsExam(['20.00', '45.00', null]);

    await resultsService.process(exam.id, TENANT_ID, 'user-1', true);

    const result = await resultRepo.findOneByOrFail({ exam_id: exam.id, student_id: student.id });
    const subjects = await dataSource
      .getRepository(ResultSubject)
      .find({ where: { result_id: result.id } });
    expect(subjects[0].grade).toBe('ABS');
    expect(result.is_fail).toBe(true);
  });

  // [ACAD-08] A mark save on a PROCESSED exam and its recompute are ONE transaction.
  async function saveMcq(examId: string, studentId: string, value: string) {
    const mcq = await componentRepo.findOneByOrFail({ exam_id: examId, name: 'MCQ' });
    return marksService.upsertBatch(
      examId,
      {
        section_id: SECTION_1_ID,
        subject_id: SUBJECT_ID,
        cells: [{ student_id: studentId, component_id: mcq.id, value, status: MarkStatus.PRESENT }],
      } as any,
      TENANT_ID,
      UserRole.ADMIN,
      SEED_ADMIN_USER_ID,
    );
  }

  it('ACAD-08: a mark save on a PROCESSED exam rewrites the result in the same commit', async () => {
    const { exam, student } = await buildPhysicsExam(['3.00', '45.00', '20.00']);
    await resultsService.process(exam.id, TENANT_ID, 'user-1', true);
    expect(
      (await resultRepo.findOneByOrFail({ exam_id: exam.id, student_id: student.id })).is_fail,
    ).toBe(true);

    // Raise MCQ above its pass mark: the result must flip to pass at once.
    const saved = await saveMcq(exam.id, student.id, '10.00');

    const result = await resultRepo.findOneByOrFail({ exam_id: exam.id, student_id: student.id });
    expect(result.is_fail).toBe(false);
    expect(result.total_marks).toBe('75.00');
    // Same commit: the result was computed no earlier than the mark's last write.
    expect(result.computed_at.getTime()).toBeGreaterThanOrEqual(saved.cells[0].saved_at.getTime());
  });

  it('ACAD-08: PROCESSED exam whose scale is gone -> 409 NO_GRADING_SCALE and the mark is NOT saved', async () => {
    const { exam, student } = await buildPhysicsExam(['3.00', '45.00', '20.00']);
    await resultsService.process(exam.id, TENANT_ID, 'user-1', true);
    await scaleRepo.softDelete({ tenant_id: TENANT_ID });

    await expect(saveMcq(exam.id, student.id, '10.00')).rejects.toMatchObject({
      status: 409,
      response: { details: { code: 'NO_GRADING_SCALE' } },
    });

    // Rolled back: MCQ still holds the old value, so no stale/fresh mismatch.
    const mcq = await componentRepo.findOneByOrFail({ exam_id: exam.id, name: 'MCQ' });
    const mark = await markRepo.findOneByOrFail({ component_id: mcq.id, student_id: student.id });
    expect(mark.value).toBe('3.00');
  });
});
