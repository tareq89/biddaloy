import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Repository, DataSource } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ResultsService } from './results.service';
import { MarkGridService } from './mark-grid.service';
import { ExamComponentsService } from './exam-components.service';
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
} from '@biddaloy/shared';

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

describe('ExamComponentsService (integration, ACAD-05 — recompute in the same transaction)', () => {
  let componentsService: ExamComponentsService;
  let resultsService: ResultsService;
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
    const module = await createTestModule(
      ALL_ENTITIES,
      [
        ResultsService,
        ExamComponentsService,
        {
          provide: AttendanceComponentService,
          useValue: {
            computeForSection: async () => ({ reason: null, valuesByStudent: new Map() }),
          },
        },
        {
          provide: AuditService,
          useValue: { record: async () => undefined, recordApproved: async () => undefined },
        },
        { provide: MarkGridService, useValue: {} },
      ],
      [],
      { synchronize: true, dropSchema: true },
    );
    componentsService = module.get(ExamComponentsService);
    resultsService = module.get(ResultsService);
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
    if (dataSource) await dataSource.destroy();
  });

  let scaleId: string;
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
    scaleId = scale.id;
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

  /** A PROCESSED exam: one student, one Written component (100), mark 40. */
  async function processedExam() {
    const student = await studentRepo.save(
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
      }),
    );
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
    await markRepo.save(
      markRepo.create({
        tenant_id: TENANT_ID,
        exam_id: exam.id,
        student_id: student.id,
        subject_id: SUBJECT_ID,
        component_id: component.id,
        value: '40.00',
        status: MarkStatus.PRESENT,
      }),
    );
    await resultsService.process(exam.id, TENANT_ID, 'user-1', true);
    return { exam, component, student };
  }

  const liveResult = (examId: string) =>
    resultRepo.findOneOrFail({ where: { exam_id: examId, tenant_id: TENANT_ID } });

  it('changing full_marks on a PROCESSED exam rewrites the results in the same commit', async () => {
    const { exam, component } = await processedExam();
    const before = await liveResult(exam.id);
    expect(before.grade).toBe('PASS');

    await componentsService.update(
      exam.id,
      component.id,
      { full_marks: '150' },
      TENANT_ID,
      'user-1',
    );

    // 40 / 150 = 26.7% -> FAIL band; the stored result changed with the part.
    const after = await liveResult(exam.id);
    expect(after.grade).toBe('F');
    expect(after.computed_at.getTime()).toBeGreaterThan(before.computed_at.getTime());
    expect((await componentRepo.findOneByOrFail({ id: component.id })).full_marks).toBe('150.00');
  });

  it('a failing recompute (no grading scale) rolls the component change back', async () => {
    const { exam, component } = await processedExam();
    await scaleRepo.softDelete({ id: scaleId });

    await expect(
      componentsService.update(exam.id, component.id, { full_marks: '50' }, TENANT_ID, 'user-1'),
    ).rejects.toMatchObject({ response: { details: { code: 'NO_GRADING_SCALE' } } });

    expect((await componentRepo.findOneByOrFail({ id: component.id })).full_marks).toBe('100.00');
  });

  it('#2246: adding a MANUAL part to a PROCESSED exam sends it back to DRAFT, so it cannot be published', async () => {
    const { exam } = await processedExam();
    const before = await liveResult(exam.id);

    await componentsService.create(
      exam.id,
      {
        subject_id: SUBJECT_ID,
        name: 'Practical',
        kind: ExamComponentKind.PRACTICAL,
        full_marks: '25',
        sequence: 2,
      } as never,
      TENANT_ID,
      'user-1',
    );

    expect((await examRepo.findOneByOrFail({ id: exam.id })).status).toBe(ExamStatus.DRAFT);
    // No recompute: the empty part was never folded in as ABSENT.
    expect((await liveResult(exam.id)).computed_at.getTime()).toBe(before.computed_at.getTime());
    await expect(resultsService.publish(exam.id, TENANT_ID, 'user-1')).rejects.toThrow(
      /must be PROCESSED/,
    );
  });

  it('full_marks below an entered mark is refused and changes nothing', async () => {
    const { exam, component } = await processedExam();
    await expect(
      componentsService.update(exam.id, component.id, { full_marks: '30' }, TENANT_ID, 'user-1'),
    ).rejects.toMatchObject({ response: { details: { code: 'FULL_MARKS_BELOW_ENTERED' } } });
    expect((await componentRepo.findOneByOrFail({ id: component.id })).full_marks).toBe('100.00');
  });
});
