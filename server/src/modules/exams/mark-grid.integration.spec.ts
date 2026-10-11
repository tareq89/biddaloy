import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import {
  EnrollmentStatus,
  ExamComponentKind,
  ExamKind,
  ExamStatus,
  MarkGridState,
  MarkStatus,
  UserRole,
} from '@biddaloy/shared';
import { AppModule } from '../../app.module';
import { SEED_TENANT_ID, SEED_ACADEMIC_YEAR_ID, SEED_CLASS_1_ID } from '@test/constants';
import { MarkGridService } from './mark-grid.service';
import { Exam } from './entities/exam.entity';
import { ExamComponent } from './entities/exam-component.entity';
import { Subject } from '../academics/entities/subject.entity';
import { School } from '../schools/entities/school.entity';
import { Class } from '../academics/entities/class.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { Student } from '../students/entities/student.entity';
import { Enrollment } from '../students/entities/enrollment.entity';
import { Mark } from './entities/mark.entity';
import { MarkGrid } from './entities/mark-grid.entity';
import { ResultsService } from './results.service';
import { SEED_ADMIN_USER_ID } from '@test/constants';

/**
 * [31.3.7b] `MarkGridService.progress` names each outstanding subject
 * (English + Bangla) straight from the database. Exams/components/subjects
 * are transactional tables wiped before every test, so they are re-seeded
 * in `beforeEach`.
 */
describe('MarkGridService.progress (integration)', () => {
  let app: TestingModule;
  let dataSource: DataSource;
  let service: MarkGridService;

  const OTHER_TENANT_ID = '00000000-0000-4000-8000-0000000007b2';
  let examId: string;

  beforeAll(async () => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-do-not-use-in-production';
    process.env.NODE_ENV = 'test';
    app = await Test.createTestingModule({ imports: [AppModule] }).compile();
    dataSource = app.get(DataSource);
    service = app.get(MarkGridService, { strict: false });
    await dataSource
      .getRepository(School)
      .save({ id: OTHER_TENANT_ID, name: 'Progress Other School', slug: 'progress-other' });
  }, 60000);

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    const exam = await dataSource.getRepository(Exam).save({
      academic_year_id: SEED_ACADEMIC_YEAR_ID,
      class_id: SEED_CLASS_1_ID,
      name: 'Progress Exam',
      kind: ExamKind.TERM,
      status: ExamStatus.DRAFT,
      tenant_id: SEED_TENANT_ID,
    });
    examId = exam.id;
  });

  async function addComponent(subjectId: string): Promise<void> {
    await dataSource.getRepository(ExamComponent).save({
      exam_id: examId,
      subject_id: subjectId,
      name: 'Written',
      kind: ExamComponentKind.WRITTEN,
      full_marks: '100',
      sequence: 1,
      tenant_id: SEED_TENANT_ID,
    });
  }

  const subjectRepo = () => dataSource.getRepository(Subject);

  it('names each outstanding subject in English and Bangla', async () => {
    const subject = await subjectRepo().save({
      tenant_id: SEED_TENANT_ID,
      name_en: 'Mathematics',
      name_bn: 'গণিত',
      code: 'PRG-M',
    });
    await addComponent(subject.id);

    const { outstanding } = await service.progress(examId, SEED_TENANT_ID);

    expect(outstanding.length).toBeGreaterThan(0);
    for (const row of outstanding) {
      expect(row).toMatchObject({
        subject_id: subject.id,
        subject_name: 'Mathematics',
        subject_name_bn: 'গণিত',
        state: MarkGridState.DRAFT,
      });
    }
  });

  it('still names a soft-deleted subject', async () => {
    const subject = await subjectRepo().save({
      tenant_id: SEED_TENANT_ID,
      name_en: 'History',
      name_bn: 'ইতিহাস',
      code: 'PRG-H',
    });
    await addComponent(subject.id);
    await subjectRepo().softDelete({ id: subject.id });

    const { outstanding } = await service.progress(examId, SEED_TENANT_ID);

    expect(outstanding.length).toBeGreaterThan(0);
    expect(outstanding[0]).toMatchObject({ subject_name: 'History', subject_name_bn: 'ইতিহাস' });
  });

  it("never returns another tenant's subject name", async () => {
    const foreign = await subjectRepo().save({
      tenant_id: OTHER_TENANT_ID,
      name_en: 'Secret',
      name_bn: 'গোপন',
      code: 'PRG-X',
    });
    await addComponent(foreign.id);

    const { outstanding } = await service.progress(examId, SEED_TENANT_ID);

    expect(outstanding.length).toBeGreaterThan(0);
    expect(outstanding[0]).toMatchObject({ subject_name: null, subject_name_bn: null });
  });
});

/**
 * [68.0 ACAD-04 / X-06] A grid with a blank cell cannot be submitted, and a
 * SUBMITTED grid that gained a blank (a student moved in) blocks processing.
 */
describe('MarkGridService blank cells (integration)', () => {
  let app: TestingModule;
  let dataSource: DataSource;
  let grids: MarkGridService;
  let results: ResultsService;
  let classId: string;
  let secA: string;
  let secB: string;
  let examId: string;
  let subjectId: string;
  let componentId: string;
  let seq = 0;

  beforeAll(async () => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-do-not-use-in-production';
    process.env.NODE_ENV = 'test';
    app = await Test.createTestingModule({ imports: [AppModule] }).compile();
    dataSource = app.get(DataSource);
    grids = app.get(MarkGridService, { strict: false });
    results = app.get(ResultsService, { strict: false });
    const cls = await dataSource.getRepository(Class).save({
      name: 'Blank Cells Class',
      academic_year_id: SEED_ACADEMIC_YEAR_ID,
      tenant_id: SEED_TENANT_ID,
    });
    classId = cls.id;
    const sections = dataSource.getRepository(ClassSection);
    secA = (
      await sections.save({ section_name: '6-A', class_id: classId, tenant_id: SEED_TENANT_ID })
    ).id;
    secB = (
      await sections.save({ section_name: '6-B', class_id: classId, tenant_id: SEED_TENANT_ID })
    ).id;
  }, 60000);

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    const exam = await dataSource.getRepository(Exam).save({
      academic_year_id: SEED_ACADEMIC_YEAR_ID,
      class_id: classId,
      name: 'Blank Exam',
      kind: ExamKind.TERM,
      status: ExamStatus.DRAFT,
      tenant_id: SEED_TENANT_ID,
    });
    examId = exam.id;
    const subject = await dataSource.getRepository(Subject).save({
      tenant_id: SEED_TENANT_ID,
      name_en: 'Math',
      name_bn: 'গণিত',
      code: `BC-${++seq}`,
    });
    subjectId = subject.id;
    componentId = (
      await dataSource.getRepository(ExamComponent).save({
        exam_id: examId,
        subject_id: subjectId,
        name: 'Written',
        kind: ExamComponentKind.WRITTEN,
        full_marks: '100',
        sequence: 1,
        tenant_id: SEED_TENANT_ID,
      })
    ).id;
  });

  async function student(sectionId: string): Promise<string> {
    const n = ++seq;
    const s = await dataSource.getRepository(Student).save({
      full_name: `Blank Student ${n}`,
      registration_number: `BC-REG-${n}`,
      roll_number: n,
      class_section_id: sectionId,
      tenant_id: SEED_TENANT_ID,
      date_of_birth: new Date('2012-01-01'),
      gender: 'MALE',
      enrollment_status: EnrollmentStatus.ACTIVE,
      preferred_communication: 'SMS',
    } as Partial<Student>);
    await dataSource.getRepository(Enrollment).save({
      student_id: s.id,
      class_id: classId,
      section_id: sectionId,
      academic_year_id: SEED_ACADEMIC_YEAR_ID,
      enrollment_status: EnrollmentStatus.ACTIVE,
      tenant_id: SEED_TENANT_ID,
    });
    return s.id;
  }

  const mark = (student_id: string, status: MarkStatus, value: string | null) =>
    dataSource.getRepository(Mark).save({
      exam_id: examId,
      subject_id: subjectId,
      component_id: componentId,
      student_id,
      status,
      value,
      tenant_id: SEED_TENANT_ID,
    });

  const submit = (sectionId: string) =>
    grids.submit(
      examId,
      { section_id: sectionId, subject_id: subjectId } as never,
      SEED_TENANT_ID,
      UserRole.ADMIN,
      SEED_ADMIN_USER_ID,
    );

  const stateOf = async (sectionId: string) =>
    (
      await dataSource
        .getRepository(MarkGrid)
        .findOne({ where: { exam_id: examId, section_id: sectionId, subject_id: subjectId } })
    )?.state;

  it('refuses a never-entered cell with GRID_INCOMPLETE and the grid stays DRAFT', async () => {
    await student(secA);
    await expect(submit(secA)).rejects.toMatchObject({
      response: { details: { code: 'GRID_INCOMPLETE', blank_count: 1 } },
    });
    expect(await stateOf(secA)).not.toBe(MarkGridState.SUBMITTED);
  });

  it('refuses a PRESENT cell with a null value', async () => {
    const id = await student(secA);
    await mark(id, MarkStatus.PRESENT, null);
    await expect(submit(secA)).rejects.toMatchObject({
      response: { details: { code: 'GRID_INCOMPLETE' } },
    });
  });

  it('accepts ABSENT, EXEMPT and PRESENT+value cells', async () => {
    await mark(await student(secA), MarkStatus.ABSENT, null);
    await mark(await student(secA), MarkStatus.EXEMPT, null);
    await mark(await student(secA), MarkStatus.PRESENT, '70.00');
    await expect(submit(secA)).resolves.toMatchObject({ state: MarkGridState.SUBMITTED });
  });

  it('X-06: a student moved into a submitted sheet blocks process until forced', async () => {
    await mark(await student(secB), MarkStatus.PRESENT, '60.00');
    await submit(secB);
    const moved = await student(secA);
    await mark(moved, MarkStatus.PRESENT, '50.00');
    await mark(await student(secA), MarkStatus.PRESENT, '55.00');
    await submit(secA);
    // the section move (what EnrollmentService.update does to the row)
    await dataSource.getRepository(Enrollment).update({ student_id: moved }, { section_id: secB });
    // moved student's mark stays; make them blank like the real case
    await dataSource.getRepository(Mark).delete({ student_id: moved });

    const { outstanding } = await grids.progress(examId, SEED_TENANT_ID);
    expect(outstanding).toEqual([
      expect.objectContaining({ section_id: secB, state: MarkGridState.SUBMITTED }),
    ]);
    await expect(results.process(examId, SEED_TENANT_ID, SEED_ADMIN_USER_ID)).rejects.toThrow(
      new RegExp(secB),
    );
  });
});
