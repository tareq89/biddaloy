import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { ConflictException } from '@nestjs/common';
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
import { StudentSubjectChoice } from '../students/entities/student-subject-choice.entity';
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
import { buildErrorResponseBody } from '../../common/filters/error-response';
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

/**
 * [35.1.9 / D44] A student's result counts only the picked member of a
 * choice group; an unpicked group blocks `process()` (even with force).
 */
describe('ResultsService (integration, choice groups)', () => {
  let resultsService: ResultsService;
  let dataSource: DataSource;
  let studentRepo: Repository<Student>;
  let enrollmentRepo: Repository<Enrollment>;
  let examRepo: Repository<Exam>;
  let componentRepo: Repository<ExamComponent>;
  let markRepo: Repository<Mark>;
  let resultRepo: Repository<Result>;
  let resultSubjectRepo: Repository<ResultSubject>;
  let subjectRepo: Repository<Subject>;
  let classSubjectRepo: Repository<ClassSubject>;
  let choiceRepo: Repository<StudentSubjectChoice>;
  let scaleRepo: Repository<GradingScale>;
  let bandRepo: Repository<GradingBand>;

  const BAN = '00000000-0000-4000-8000-0000000d0041';
  const ISLAM = '00000000-0000-4000-8000-0000000d0042';
  const HINDU = '00000000-0000-4000-8000-0000000d0043';

  let csIslam: ClassSubject;
  let csHindu: ClassSubject;
  let examId: string;
  const compBySubject = new Map<string, ExamComponent>();
  let studentA: Student;
  let studentB: Student;

  beforeAll(async () => {
    const stubAttendance = {
      computeForSection: async () => ({ reason: null, valuesByStudent: new Map() }),
    };
    const stubAudit = { record: async () => undefined, recordApproved: async () => undefined };
    const stubAuthz = {
      assertCanRead: async () => undefined,
      assertCanWrite: async () => undefined,
    };
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
    dataSource = module.get(DataSource);
    studentRepo = module.get(getRepositoryToken(Student));
    enrollmentRepo = module.get(getRepositoryToken(Enrollment));
    examRepo = module.get(getRepositoryToken(Exam));
    componentRepo = module.get(getRepositoryToken(ExamComponent));
    markRepo = module.get(getRepositoryToken(Mark));
    resultRepo = module.get(getRepositoryToken(Result));
    resultSubjectRepo = module.get(getRepositoryToken(ResultSubject));
    subjectRepo = module.get(getRepositoryToken(Subject));
    classSubjectRepo = module.get(getRepositoryToken(ClassSubject));
    choiceRepo = module.get(getRepositoryToken(StudentSubjectChoice));
    scaleRepo = module.get(getRepositoryToken(GradingScale));
    bandRepo = module.get(getRepositoryToken(GradingBand));
    await seedReferenceData(dataSource);
  }, 60000);

  afterAll(async () => {
    if (dataSource) await dataSource.destroy();
  });

  async function addSubject(id: string, code: string, choiceGroup: string | null) {
    await subjectRepo.save(subjectRepo.create({ id, name_en: code, code, tenant_id: TENANT_ID }));
    return classSubjectRepo.save(
      classSubjectRepo.create({
        class_id: CLASS_1_ID,
        subject_id: id,
        academic_year_id: YEAR_1_ID,
        is_optional: false,
        is_graded_only: false,
        choice_group: choiceGroup,
        tenant_id: TENANT_ID,
      }),
    );
  }

  async function addComponent(subjectId: string) {
    const c = await componentRepo.save(
      componentRepo.create({
        tenant_id: TENANT_ID,
        exam_id: examId,
        subject_id: subjectId,
        name: 'Written',
        kind: ExamComponentKind.WRITTEN,
        source: ExamComponentSource.MANUAL,
        full_marks: '100',
        sequence: 1,
      }),
    );
    compBySubject.set(subjectId, c);
    return c;
  }

  async function putMark(student: Student, subjectId: string, value: string | null) {
    await markRepo.save(
      markRepo.create({
        tenant_id: TENANT_ID,
        exam_id: examId,
        student_id: student.id,
        subject_id: subjectId,
        component_id: compBySubject.get(subjectId)!.id,
        value,
        status: value === null ? MarkStatus.ABSENT : MarkStatus.PRESENT,
      }),
    );
  }

  async function buildStudent(roll: number, name: string): Promise<Student> {
    const s = await studentRepo.save(
      studentRepo.create({
        full_name: name,
        registration_number: `REG-${Math.random()}`,
        roll_number: roll,
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
        student_id: s.id,
        class_id: CLASS_1_ID,
        section_id: SECTION_1_ID,
        academic_year_id: YEAR_1_ID,
        enrollment_status: EnrollmentStatus.ACTIVE,
        tenant_id: TENANT_ID,
      }),
    );
    return s;
  }

  function pick(student: Student, cs: ClassSubject) {
    return choiceRepo.save(
      choiceRepo.create({
        tenant_id: TENANT_ID,
        student_id: student.id,
        class_subject_id: cs.id,
        academic_year_id: YEAR_1_ID,
        is_fourth: false,
      }),
    );
  }

  async function subjectsOf(studentId: string): Promise<{ r: Result; ids: string[] }> {
    const r = await resultRepo.findOneByOrFail({
      exam_id: examId,
      student_id: studentId,
      tenant_id: TENANT_ID,
    });
    const rs = await resultSubjectRepo.find({ where: { result_id: r.id } });
    return { r, ids: rs.map((x) => x.subject_id).sort() };
  }

  // Global beforeEach (test/setup.ts) wipes transactional tables, so build all of it here.
  beforeEach(async () => {
    compBySubject.clear();
    await addSubject(BAN, 'BAN', null);
    csIslam = await addSubject(ISLAM, 'ISL', 'RELIGION');
    csHindu = await addSubject(HINDU, 'HIN', 'RELIGION');
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
    const exam = await examRepo.save(
      examRepo.create({
        tenant_id: TENANT_ID,
        academic_year_id: YEAR_1_ID,
        class_id: CLASS_1_ID,
        name: 'Term',
        kind: ExamKind.TERM,
        status: ExamStatus.DRAFT,
      }),
    );
    examId = exam.id;
    studentA = await buildStudent(1, 'Alice Islam');
    studentB = await buildStudent(2, 'Bob Hindu');
  });

  it('counts only the picked member; non-takers absent cells give no false F', async () => {
    await addComponent(BAN);
    await addComponent(ISLAM);
    await addComponent(HINDU);
    await pick(studentA, csIslam);
    await pick(studentB, csHindu);
    await putMark(studentA, BAN, '80');
    await putMark(studentA, ISLAM, '70');
    await putMark(studentA, HINDU, null); // non-taker: ABSENT
    await putMark(studentB, BAN, '60');
    await putMark(studentB, ISLAM, null);
    await putMark(studentB, HINDU, '90');

    expect((await resultsService.process(examId, TENANT_ID, 'u1', true)).processed).toBe(2);

    const a = await subjectsOf(studentA.id);
    expect(a.ids).toEqual([BAN, ISLAM].sort());
    expect(a.r.is_fail).toBe(false);
    const b = await subjectsOf(studentB.id);
    expect(b.ids).toEqual([BAN, HINDU].sort());
    expect(b.r.is_fail).toBe(false);
  });

  it('an unpicked group blocks process with 409 + names, even with force, writing nothing', async () => {
    await addComponent(BAN);
    await addComponent(ISLAM);
    await addComponent(HINDU);
    await pick(studentA, csIslam); // B has no pick
    await putMark(studentA, BAN, '80');
    await putMark(studentA, ISLAM, '70');
    await putMark(studentB, BAN, '60');

    const err: any = await resultsService.process(examId, TENANT_ID, 'u1', true).then(
      () => null,
      (e) => e,
    );
    expect(err).toBeInstanceOf(ConflictException);
    // Asserted through the real HTTP error builder: only `message` +
    // `details` reach the client, so the names must live under `details`.
    const body = buildErrorResponseBody(err, { path: '/p', requestId: 'r', nodeEnv: 'test' })
      .details as any;
    expect(body.code).toBe('CHOICE_GROUP_UNPICKED');
    expect(body.total).toBe(1);
    expect(body.missing).toEqual([
      {
        student_id: studentB.id,
        full_name: 'Bob Hindu',
        roll_number: 2,
        choice_group: 'RELIGION',
      },
    ]);
    expect(await resultRepo.count({ where: { exam_id: examId } })).toBe(0);
  });

  it('a group whose subjects are not tested in the exam is ignored', async () => {
    await addComponent(BAN); // no components for ISLAM / HINDU
    await putMark(studentA, BAN, '80');
    await putMark(studentB, BAN, '60');

    expect((await resultsService.process(examId, TENANT_ID, 'u1', true)).processed).toBe(2);
    expect((await subjectsOf(studentA.id)).ids).toEqual([BAN]);
  });

  it('recompute after a mark edit with a pick missing does not throw', async () => {
    await addComponent(BAN);
    await addComponent(ISLAM);
    await addComponent(HINDU);
    await pick(studentA, csIslam);
    await pick(studentB, csHindu);
    await putMark(studentA, BAN, '80');
    await putMark(studentA, ISLAM, '70');
    await putMark(studentB, BAN, '60');
    await putMark(studentB, HINDU, '90');
    await resultsService.process(examId, TENANT_ID, 'u1', true);

    await choiceRepo.delete({ student_id: studentB.id });
    await markRepo.update(
      { exam_id: examId, student_id: studentB.id, subject_id: BAN },
      { value: '65' },
    );
    await expect(
      resultsService.recomputeIfProcessed(examId, [studentB.id], TENANT_ID, 'u1'),
    ).resolves.toBeUndefined();
    expect((await subjectsOf(studentB.id)).ids).toEqual([BAN]);
  });
});
