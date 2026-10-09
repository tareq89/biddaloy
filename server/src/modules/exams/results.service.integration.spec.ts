import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Repository, DataSource } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ResultsService } from './results.service';
import { MarkGridService } from './mark-grid.service';
import { Exam } from './entities/exam.entity';
import { ExamComponent } from './entities/exam-component.entity';
import { Mark } from './entities/mark.entity';
import { Result } from './entities/result.entity';
import { ResultSubject } from './entities/result-subject.entity';
import { ClassSubject } from '../academics/entities/class-subject.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { Subject } from '../academics/entities/subject.entity';
import { Student } from '../students/entities/student.entity';
import { Enrollment } from '../students/entities/enrollment.entity';
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
import { SEED_TENANT_ID } from '@test/constants';
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
        { provide: AttendanceComponentService, useValue: stubAttendance },
        { provide: AuditService, useValue: stubAudit },
        { provide: MarksAuthorizationService, useValue: stubAuthz },
      ],
      [],
      { synchronize: true, dropSchema: true },
    );

    resultsService = module.get(ResultsService);
    markGridService = module.get(MarkGridService);
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
});
