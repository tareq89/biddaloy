import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { ConflictException, UnprocessableEntityException } from '@nestjs/common';
import { Repository, DataSource } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import { PromotionsService } from './promotions.service';
import { PromotionRun } from './entities/promotion-run.entity';
import { PromotionEntry } from './entities/promotion-entry.entity';
import { Student } from '../students/entities/student.entity';
import { Class } from '../academics/entities/class.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { Enrollment } from '../students/entities/enrollment.entity';
import { Exam } from '../exams/entities/exam.entity';
import { Result } from '../exams/entities/result.entity';
import { GradingScale } from '../grading/entities/grading-scale.entity';
import { School } from '../schools/entities/school.entity';
import { EnrollmentService } from '../enrollments/enrollments.service';
import { AuditService } from '../audit/audit.service';
import { ApprovalService } from '../auth/guards/approval.guard';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { SEED_TENANT_ID } from '@test/constants';
import {
  EnrollmentStatus,
  ExamStatus,
  ExamKind,
  PromotionOutcome,
  PromotionRunStatus,
  PlacementAlgorithm,
} from '@biddaloy/shared';

const SOURCE_YEAR_ID = '00000000-0000-4000-8000-000000010001';
const TARGET_YEAR_ID = '00000000-0000-4000-8000-000000010002';
const SOURCE_CLASS_ID = '00000000-0000-4000-8000-000000010010';
const SOURCE_SECTION_ID = '00000000-0000-4000-8000-000000010011';
const TARGET_CLASS_ID = '00000000-0000-4000-8000-000000010020';
const TARGET_SECTION_ID = '00000000-0000-4000-8000-000000010021';
// D20 retain classes: resolveTarget() requires a same-grade class to exist
// in the target year for ANY run on that source grade (any entry could end
// up RETAIN via override), so every source grade used below needs one.
const RETAIN_CLASS_ID = '00000000-0000-4000-8000-000000010040';
const RETAIN_SECTION_ID = '00000000-0000-4000-8000-000000010041';
// `created_by_user_id` etc. are plain uuid columns (no FK on promotion_runs
// itself), but `audit_logs.performed_by_user_id` DOES have an FK to
// `users(id)` — so commit()'s audit rows need a real user row to reference.
const ADMIN_USER_ID = '00000000-0000-4000-8000-000000010050';

async function seedReferenceData(ds: DataSource): Promise<void> {
  await ds.query('DELETE FROM promotion_entries');
  await ds.query('DELETE FROM promotion_runs');
  await ds.query('DELETE FROM results');
  await ds.query('DELETE FROM exams');
  await ds.query('DELETE FROM grading_scales');
  await ds.query('DELETE FROM enrollments');
  await ds.query('DELETE FROM student_guardians');
  await ds.query('DELETE FROM students');
  await ds.query('DELETE FROM class_sections');
  await ds.query('DELETE FROM classes');
  await ds.query('DELETE FROM academic_years');
  await ds.query('DELETE FROM schools');
  await ds.query('DELETE FROM users WHERE id = $1', [ADMIN_USER_ID]);

  await ds.query(`INSERT INTO users (id, full_name) VALUES ($1, 'Test Admin')`, [ADMIN_USER_ID]);

  const schoolRepo = ds.getRepository(School);
  const ayRepo = ds.getRepository(AcademicYear);
  const classRepo = ds.getRepository(Class);
  const sectionRepo = ds.getRepository(ClassSection);

  await schoolRepo.save(
    schoolRepo.create({
      id: SEED_TENANT_ID,
      name: 'Test School',
      slug: 'test-school',
      tenant_id: SEED_TENANT_ID,
    }),
  );
  await ayRepo.save(
    ayRepo.create({
      id: SOURCE_YEAR_ID,
      name: '2026',
      start_date: new Date('2026-01-01'),
      end_date: new Date('2026-12-31'),
      is_current: true,
      tenant_id: SEED_TENANT_ID,
    }),
  );
  await ayRepo.save(
    ayRepo.create({
      id: TARGET_YEAR_ID,
      name: '2027',
      start_date: new Date('2027-01-01'),
      end_date: new Date('2027-12-31'),
      is_current: false,
      tenant_id: SEED_TENANT_ID,
    }),
  );
  await classRepo.save(
    classRepo.create({
      id: SOURCE_CLASS_ID,
      name: 'Class Five',
      numeric_grade: 5,
      academic_year_id: SOURCE_YEAR_ID,
      tenant_id: SEED_TENANT_ID,
    }),
  );
  await sectionRepo.save(
    sectionRepo.create({
      id: SOURCE_SECTION_ID,
      section_name: 'A',
      class_id: SOURCE_CLASS_ID,
      tenant_id: SEED_TENANT_ID,
    }),
  );
  await classRepo.save(
    classRepo.create({
      id: TARGET_CLASS_ID,
      name: 'Class Six',
      numeric_grade: 6,
      academic_year_id: TARGET_YEAR_ID,
      tenant_id: SEED_TENANT_ID,
    }),
  );
  await sectionRepo.save(
    sectionRepo.create({
      id: TARGET_SECTION_ID,
      section_name: 'A',
      class_id: TARGET_CLASS_ID,
      capacity: null,
      tenant_id: SEED_TENANT_ID,
    }),
  );
  // Grade 5 (== SOURCE_CLASS_ID's grade) in the target year, so D20's
  // retain-class check doesn't block every run on the source class.
  await classRepo.save(
    classRepo.create({
      id: RETAIN_CLASS_ID,
      name: 'Class Five (retained)',
      numeric_grade: 5,
      academic_year_id: TARGET_YEAR_ID,
      tenant_id: SEED_TENANT_ID,
    }),
  );
  await sectionRepo.save(
    sectionRepo.create({
      id: RETAIN_SECTION_ID,
      section_name: 'A',
      class_id: RETAIN_CLASS_ID,
      tenant_id: SEED_TENANT_ID,
    }),
  );
}

describe('PromotionsService (integration)', () => {
  let service: PromotionsService;
  let dataSource: DataSource;
  let studentRepo: Repository<Student>;
  let enrollmentRepo: Repository<Enrollment>;
  let runRepo: Repository<PromotionRun>;
  let entryRepo: Repository<PromotionEntry>;
  let examRepo: Repository<Exam>;
  let resultRepo: Repository<Result>;
  let gradingScaleRepo: Repository<GradingScale>;
  const TENANT_ID = SEED_TENANT_ID;
  let examId: string;
  let gradingScaleId: string;

  beforeAll(async () => {
    const module = await createTestModule(
      ALL_ENTITIES,
      [
        PromotionsService,
        EnrollmentService,
        AuditService,
        { provide: ApprovalService, useValue: { consume: vi.fn() } },
      ],
      [],
      { synchronize: true, dropSchema: true },
    );

    service = module.get(PromotionsService);
    dataSource = module.get(DataSource);
    studentRepo = module.get(getRepositoryToken(Student));
    enrollmentRepo = module.get(getRepositoryToken(Enrollment));
    runRepo = module.get(getRepositoryToken(PromotionRun));
    entryRepo = module.get(getRepositoryToken(PromotionEntry));
    examRepo = module.get(getRepositoryToken(Exam));
    resultRepo = module.get(getRepositoryToken(Result));
    gradingScaleRepo = module.get(getRepositoryToken(GradingScale));

    await seedReferenceData(dataSource);
  }, 60000);

  afterAll(async () => {
    if (dataSource) await dataSource.destroy();
  });

  beforeEach(async () => {
    await dataSource.query('DELETE FROM promotion_entries');
    await dataSource.query('DELETE FROM promotion_runs');
    await dataSource.query('DELETE FROM results');
    await dataSource.query('DELETE FROM exams');
    await dataSource.query('DELETE FROM grading_scales');
    await dataSource.query('DELETE FROM enrollments');
    await dataSource.query('DELETE FROM student_guardians');
    await dataSource.query('DELETE FROM students');

    const scale = await gradingScaleRepo.save(
      gradingScaleRepo.create({
        academic_year_id: SOURCE_YEAR_ID,
        class_id: null,
        name: 'Default',
        revision: 1,
        tenant_id: TENANT_ID,
      }),
    );
    gradingScaleId = scale.id;

    const exam = await examRepo.save(
      examRepo.create({
        tenant_id: TENANT_ID,
        academic_year_id: SOURCE_YEAR_ID,
        class_id: SOURCE_CLASS_ID,
        name: 'Final Exam',
        kind: ExamKind.TERM,
        status: ExamStatus.PUBLISHED,
      }),
    );
    examId = exam.id;
  });

  async function buildStudent(overrides: Partial<Student> = {}): Promise<Student> {
    return studentRepo.save(
      studentRepo.create({
        full_name: 'Test Student',
        registration_number: `REG-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        roll_number: 1,
        class_section_id: SOURCE_SECTION_ID,
        tenant_id: TENANT_ID,
        enrollment_status: EnrollmentStatus.ACTIVE,
        preferred_communication: 'SMS',
        ...overrides,
      }),
    );
  }

  async function enrollActive(studentId: string): Promise<Enrollment> {
    return enrollmentRepo.save(
      enrollmentRepo.create({
        student_id: studentId,
        class_id: SOURCE_CLASS_ID,
        section_id: SOURCE_SECTION_ID,
        academic_year_id: SOURCE_YEAR_ID,
        tenant_id: TENANT_ID,
        enrollment_status: EnrollmentStatus.ACTIVE,
      }),
    );
  }

  async function addResult(
    studentId: string,
    opts: { isFail: boolean; gpa: number; total: number; computedAt?: Date },
  ) {
    return resultRepo.save(
      resultRepo.create({
        tenant_id: TENANT_ID,
        exam_id: examId,
        student_id: studentId,
        total_marks: opts.total.toFixed(2),
        gpa: opts.gpa.toFixed(2),
        grade: opts.isFail ? 'F' : 'A',
        is_fail: opts.isFail,
        grading_scale_id: gradingScaleId,
        grading_scale_revision: 1,
        rule_version: 'v1',
        computed_at: opts.computedAt ?? new Date(),
      }),
    );
  }

  describe('create', () => {
    it('suggests RETAIN for a student missing a result on one of the selected exams (D6)', async () => {
      const passing = await buildStudent({ registration_number: 'REG-A', roll_number: 1 });
      await enrollActive(passing.id);
      await addResult(passing.id, { isFail: false, gpa: 4.5, total: 400 });

      const missing = await buildStudent({ registration_number: 'REG-B', roll_number: 2 });
      await enrollActive(missing.id);
      // No result for `missing` — a missing result counts as failed.

      const run = await service.create(
        {
          source_class_id: SOURCE_CLASS_ID,
          target_academic_year_id: TARGET_YEAR_ID,
          exam_ids: [examId],
          algorithm: PlacementAlgorithm.BLOCK,
        },
        TENANT_ID,
        ADMIN_USER_ID,
      );

      const entries = await entryRepo.find({ where: { run_id: run.id } });
      const passingEntry = entries.find((e) => e.student_id === passing.id);
      const missingEntry = entries.find((e) => e.student_id === missing.id);
      expect(passingEntry?.suggested_outcome).toBe(PromotionOutcome.PROMOTE);
      expect(missingEntry?.suggested_outcome).toBe(PromotionOutcome.RETAIN);
      expect(missingEntry?.passed_all).toBe(false);
    });
  });

  describe('patchEntries', () => {
    it('throws 422 when overriding without a note', async () => {
      const student = await buildStudent();
      await enrollActive(student.id);
      await addResult(student.id, { isFail: false, gpa: 4.0, total: 400 });

      const run = await service.create(
        {
          source_class_id: SOURCE_CLASS_ID,
          target_academic_year_id: TARGET_YEAR_ID,
          exam_ids: [examId],
          algorithm: PlacementAlgorithm.BLOCK,
        },
        TENANT_ID,
        ADMIN_USER_ID,
      );

      await expect(
        service.patchEntries(
          run.id,
          [{ student_id: student.id, final_outcome: PromotionOutcome.RETAIN }],
          TENANT_ID,
          ADMIN_USER_ID,
        ),
      ).rejects.toThrow(UnprocessableEntityException);
    });
  });

  describe('refresh', () => {
    it('keeps an overridden final_outcome and note after refresh (D24)', async () => {
      const student = await buildStudent();
      await enrollActive(student.id);
      await addResult(student.id, { isFail: false, gpa: 4.0, total: 400 });

      const run = await service.create(
        {
          source_class_id: SOURCE_CLASS_ID,
          target_academic_year_id: TARGET_YEAR_ID,
          exam_ids: [examId],
          algorithm: PlacementAlgorithm.BLOCK,
        },
        TENANT_ID,
        ADMIN_USER_ID,
      );

      await service.patchEntries(
        run.id,
        [
          {
            student_id: student.id,
            final_outcome: PromotionOutcome.RETAIN,
            override_note: 'Manual hold',
          },
        ],
        TENANT_ID,
        ADMIN_USER_ID,
      );

      await service.refresh(run.id, TENANT_ID);

      const entry = await entryRepo.findOne({ where: { run_id: run.id, student_id: student.id } });
      expect(entry?.final_outcome).toBe(PromotionOutcome.RETAIN);
      expect(entry?.override_note).toBe('Manual hold');
      expect(entry?.is_override).toBe(true);
    });
  });

  describe('commit', () => {
    it('creates enrollments with no overrides, and findCurrentByStudent returns the target year', async () => {
      const student = await buildStudent();
      await enrollActive(student.id);
      await addResult(student.id, { isFail: false, gpa: 4.0, total: 400 });

      const run = await service.create(
        {
          source_class_id: SOURCE_CLASS_ID,
          target_academic_year_id: TARGET_YEAR_ID,
          exam_ids: [examId],
          algorithm: PlacementAlgorithm.BLOCK,
        },
        TENANT_ID,
        ADMIN_USER_ID,
      );

      await service.commit(run.id, TENANT_ID, ADMIN_USER_ID, 'ADMIN', { headers: {} });

      const committedRun = await runRepo.findOne({ where: { id: run.id } });
      expect(committedRun?.status).toBe(PromotionRunStatus.COMMITTED);

      const current = await enrollmentRepo.findOne({
        where: {
          student_id: student.id,
          academic_year_id: TARGET_YEAR_ID,
          enrollment_status: EnrollmentStatus.ACTIVE,
        },
      });
      expect(current).not.toBeNull();
      expect(current?.class_id).toBe(TARGET_CLASS_ID);
    });

    it('renumbers a pre-existing occupant of the target section to n+1 (D19)', async () => {
      const occupant = await buildStudent({
        registration_number: 'REG-OCC',
        class_section_id: TARGET_SECTION_ID,
        roll_number: 1,
      });
      await enrollmentRepo.save(
        enrollmentRepo.create({
          student_id: occupant.id,
          class_id: TARGET_CLASS_ID,
          section_id: TARGET_SECTION_ID,
          academic_year_id: TARGET_YEAR_ID,
          tenant_id: TENANT_ID,
          enrollment_status: EnrollmentStatus.ACTIVE,
        }),
      );

      const promoted = await buildStudent({ registration_number: 'REG-PROMOTED' });
      await enrollActive(promoted.id);
      await addResult(promoted.id, { isFail: false, gpa: 4.0, total: 400 });

      const run = await service.create(
        {
          source_class_id: SOURCE_CLASS_ID,
          target_academic_year_id: TARGET_YEAR_ID,
          exam_ids: [examId],
          algorithm: PlacementAlgorithm.BLOCK,
        },
        TENANT_ID,
        ADMIN_USER_ID,
      );

      await service.commit(run.id, TENANT_ID, ADMIN_USER_ID, 'ADMIN', { headers: {} });

      const renumberedOccupant = await studentRepo.findOne({ where: { id: occupant.id } });
      expect(renumberedOccupant?.roll_number).toBe(2); // n=1 promoted student, occupant pushed to 2
    });

    it('rolls back fully if one enrollment insert fails', async () => {
      const s1 = await buildStudent({ registration_number: 'REG-1', roll_number: 1 });
      await enrollActive(s1.id);
      await addResult(s1.id, { isFail: false, gpa: 4.0, total: 400 });

      const s2 = await buildStudent({ registration_number: 'REG-2', roll_number: 2 });
      await enrollActive(s2.id);
      await addResult(s2.id, { isFail: false, gpa: 3.5, total: 380 });

      const run = await service.create(
        {
          source_class_id: SOURCE_CLASS_ID,
          target_academic_year_id: TARGET_YEAR_ID,
          exam_ids: [examId],
          algorithm: PlacementAlgorithm.BLOCK,
        },
        TENANT_ID,
        ADMIN_USER_ID,
      );

      // Force EnrollmentService.createInTransaction to fail for s2 by
      // giving it a pre-existing ACTIVE enrollment in the target year —
      // the service's own duplicate-active check throws ConflictException.
      await enrollmentRepo.save(
        enrollmentRepo.create({
          student_id: s2.id,
          class_id: TARGET_CLASS_ID,
          section_id: TARGET_SECTION_ID,
          academic_year_id: TARGET_YEAR_ID,
          tenant_id: TENANT_ID,
          enrollment_status: EnrollmentStatus.ACTIVE,
        }),
      );

      await expect(
        service.commit(run.id, TENANT_ID, ADMIN_USER_ID, 'ADMIN', { headers: {} }),
      ).rejects.toThrow();

      const stillDraft = await runRepo.findOne({ where: { id: run.id } });
      expect(stillDraft?.status).toBe(PromotionRunStatus.DRAFT);

      // s1's enrollment must not have been created either — the whole
      // commit is one transaction.
      const s1Enrollments = await enrollmentRepo.find({
        where: { student_id: s1.id, academic_year_id: TARGET_YEAR_ID },
      });
      expect(s1Enrollments).toHaveLength(0);
    });

    it('refuses commit with 409 when a selected exam has a result newer than refreshed_at (stale results)', async () => {
      const student = await buildStudent();
      await enrollActive(student.id);
      await addResult(student.id, { isFail: false, gpa: 4.0, total: 400 });

      const run = await service.create(
        {
          source_class_id: SOURCE_CLASS_ID,
          target_academic_year_id: TARGET_YEAR_ID,
          exam_ids: [examId],
          algorithm: PlacementAlgorithm.BLOCK,
        },
        TENANT_ID,
        ADMIN_USER_ID,
      );

      // Simulate a recompute after the run's refreshed_at snapshot: the
      // `(exam_id, student_id)` result is unique, so a reprocess updates
      // the existing row's computed_at rather than inserting a new one.
      await resultRepo.update(
        { exam_id: examId, student_id: student.id },
        { gpa: '4.20', total_marks: '410.00', computed_at: new Date(Date.now() + 60_000) },
      );

      await expect(
        service.commit(run.id, TENANT_ID, ADMIN_USER_ID, 'ADMIN', { headers: {} }),
      ).rejects.toThrow(ConflictException);
    });

    it('a second commit attempt on an already-COMMITTED run returns 409', async () => {
      const student = await buildStudent();
      await enrollActive(student.id);
      await addResult(student.id, { isFail: false, gpa: 4.0, total: 400 });

      const run = await service.create(
        {
          source_class_id: SOURCE_CLASS_ID,
          target_academic_year_id: TARGET_YEAR_ID,
          exam_ids: [examId],
          algorithm: PlacementAlgorithm.BLOCK,
        },
        TENANT_ID,
        ADMIN_USER_ID,
      );

      await service.commit(run.id, TENANT_ID, ADMIN_USER_ID, 'ADMIN', { headers: {} });

      await expect(
        service.commit(run.id, TENANT_ID, ADMIN_USER_ID, 'ADMIN', { headers: {} }),
      ).rejects.toThrow(ConflictException);
    });

    it('sets GRADUATED on both the enrollment and the student for a whole-class graduation run (D18)', async () => {
      // A class with no numeric_grade + 1 match and numeric_grade set →
      // resolveTarget graduates the whole run (target_class_id = null).
      const gradClassId = '00000000-0000-4000-8000-000000010030';
      const gradSectionId = '00000000-0000-4000-8000-000000010031';
      const classRepo = dataSource.getRepository(Class);
      const sectionRepo = dataSource.getRepository(ClassSection);
      await classRepo.save(
        classRepo.create({
          id: gradClassId,
          name: 'Class Twelve',
          numeric_grade: 12,
          academic_year_id: SOURCE_YEAR_ID,
          tenant_id: TENANT_ID,
        }),
      );
      await sectionRepo.save(
        sectionRepo.create({
          id: gradSectionId,
          section_name: 'A',
          class_id: gradClassId,
          tenant_id: TENANT_ID,
        }),
      );
      // D20 retain class for grade 12 in the target year, else resolveTarget
      // blocks with RETAIN_CLASS_MISSING before it ever reaches GRADUATE.
      const gradRetainClassId = '00000000-0000-4000-8000-000000010032';
      const gradRetainSectionId = '00000000-0000-4000-8000-000000010033';
      await classRepo.save(
        classRepo.create({
          id: gradRetainClassId,
          name: 'Class Twelve (retained)',
          numeric_grade: 12,
          academic_year_id: TARGET_YEAR_ID,
          tenant_id: TENANT_ID,
        }),
      );
      await sectionRepo.save(
        sectionRepo.create({
          id: gradRetainSectionId,
          section_name: 'A',
          class_id: gradRetainClassId,
          tenant_id: TENANT_ID,
        }),
      );

      const gradExam = await examRepo.save(
        examRepo.create({
          tenant_id: TENANT_ID,
          academic_year_id: SOURCE_YEAR_ID,
          class_id: gradClassId,
          name: 'Final Exam (Grad)',
          kind: ExamKind.TERM,
          status: ExamStatus.PUBLISHED,
        }),
      );

      const student = await buildStudent({
        registration_number: 'REG-GRAD',
        class_section_id: gradSectionId,
      });
      const enrollment = await enrollmentRepo.save(
        enrollmentRepo.create({
          student_id: student.id,
          class_id: gradClassId,
          section_id: gradSectionId,
          academic_year_id: SOURCE_YEAR_ID,
          tenant_id: TENANT_ID,
          enrollment_status: EnrollmentStatus.ACTIVE,
        }),
      );
      await resultRepo.save(
        resultRepo.create({
          tenant_id: TENANT_ID,
          exam_id: gradExam.id,
          student_id: student.id,
          total_marks: '450.00',
          gpa: '5.00',
          grade: 'A+',
          is_fail: false,
          grading_scale_id: gradingScaleId,
          grading_scale_revision: 1,
          rule_version: 'v1',
          computed_at: new Date(),
        }),
      );

      const run = await service.create(
        {
          source_class_id: gradClassId,
          target_academic_year_id: TARGET_YEAR_ID,
          exam_ids: [gradExam.id],
          algorithm: PlacementAlgorithm.BLOCK,
        },
        TENANT_ID,
        ADMIN_USER_ID,
      );

      const entry = await entryRepo.findOne({ where: { run_id: run.id, student_id: student.id } });
      expect(entry?.suggested_outcome).toBe(PromotionOutcome.GRADUATE);

      await service.commit(run.id, TENANT_ID, ADMIN_USER_ID, 'ADMIN', { headers: {} });

      const graduatedStudent = await studentRepo.findOne({ where: { id: student.id } });
      expect(graduatedStudent?.enrollment_status).toBe(EnrollmentStatus.GRADUATED);
      const graduatedEnrollment = await enrollmentRepo.findOne({ where: { id: enrollment.id } });
      expect(graduatedEnrollment?.enrollment_status).toBe(EnrollmentStatus.GRADUATED);
    });

    it('leaves an already-committed run and its results intact after a source exam is reprocessed (with #994)', async () => {
      const student = await buildStudent();
      await enrollActive(student.id);
      await addResult(student.id, { isFail: false, gpa: 4.0, total: 400 });

      const run = await service.create(
        {
          source_class_id: SOURCE_CLASS_ID,
          target_academic_year_id: TARGET_YEAR_ID,
          exam_ids: [examId],
          algorithm: PlacementAlgorithm.BLOCK,
        },
        TENANT_ID,
        ADMIN_USER_ID,
      );
      await service.commit(run.id, TENANT_ID, ADMIN_USER_ID, 'ADMIN', { headers: {} });

      // Reprocessing the source exam after commit (e.g. a mark correction)
      // must not touch the already-committed run or its entries. Same
      // unique-index reasoning as the stale-results test above: update in
      // place, don't insert a second row.
      await resultRepo.update(
        { exam_id: examId, student_id: student.id },
        { gpa: '4.50', total_marks: '420.00', computed_at: new Date(Date.now() + 5000) },
      );

      const committedRun = await runRepo.findOne({ where: { id: run.id } });
      const entry = await entryRepo.findOne({ where: { run_id: run.id, student_id: student.id } });
      expect(committedRun?.status).toBe(PromotionRunStatus.COMMITTED);
      expect(entry?.final_outcome).toBe(PromotionOutcome.PROMOTE);
    });
  });

  describe('remove', () => {
    // B6 — remove() must not delete a run that committed between the read
    // and the delete: the delete's own WHERE now carries status = DRAFT,
    // so a run that's already COMMITTED by the time remove() reaches the
    // delete leaves zero rows affected and throws instead of destroying
    // the committed run's audit trail.
    it('refuses to delete a run that is COMMITTED, and leaves its entries intact', async () => {
      const student = await buildStudent();
      await enrollActive(student.id);
      await addResult(student.id, { isFail: false, gpa: 4.0, total: 400 });

      const run = await service.create(
        {
          source_class_id: SOURCE_CLASS_ID,
          target_academic_year_id: TARGET_YEAR_ID,
          exam_ids: [examId],
          algorithm: PlacementAlgorithm.BLOCK,
        },
        TENANT_ID,
        ADMIN_USER_ID,
      );

      await service.commit(run.id, TENANT_ID, ADMIN_USER_ID, 'ADMIN', { headers: {} });

      // remove()'s own initial findOne read sees the (now-stale) DRAFT
      // status it was called with is irrelevant here — commit() already
      // flipped the row to COMMITTED before remove() is even invoked, so
      // this exercises the same "status changed under us" path the DELETE
      // WHERE guards against.
      await expect(service.remove(run.id, TENANT_ID)).rejects.toThrow(ConflictException);

      const stillThere = await runRepo.findOne({ where: { id: run.id } });
      expect(stillThere).not.toBeNull();
      expect(stillThere?.status).toBe(PromotionRunStatus.COMMITTED);
      const entries = await entryRepo.find({ where: { run_id: run.id } });
      expect(entries.length).toBeGreaterThan(0);
    });

    it('deletes a DRAFT run', async () => {
      const student = await buildStudent();
      await enrollActive(student.id);
      await addResult(student.id, { isFail: false, gpa: 4.0, total: 400 });

      const run = await service.create(
        {
          source_class_id: SOURCE_CLASS_ID,
          target_academic_year_id: TARGET_YEAR_ID,
          exam_ids: [examId],
          algorithm: PlacementAlgorithm.BLOCK,
        },
        TENANT_ID,
        ADMIN_USER_ID,
      );

      await service.remove(run.id, TENANT_ID);

      const gone = await runRepo.findOne({ where: { id: run.id } });
      expect(gone).toBeNull();
    });
  });

  describe('findRetainClass (M1 — null-grade source)', () => {
    // A null numeric_grade has no identity signal to match a retain class
    // on: an IsNull() lookup would previously wildcard-match ANY other
    // null-grade class in the target year (e.g. retaining Playgroup into
    // Nursery). commit()'s RETAIN path must instead refuse with
    // RETAIN_CLASS_MISSING rather than guess.
    it('does not wildcard-match an unrelated null-grade class as the retain class on commit', async () => {
      const classRepo = dataSource.getRepository(Class);
      const sectionRepo = dataSource.getRepository(ClassSection);

      // Source: a null-grade class (e.g. "Playgroup") with an explicit
      // target class chosen (so resolveTarget's create-time PICK_TARGET_CLASS
      // guard doesn't block before we even get to commit).
      const playgroupId = '00000000-0000-4000-8000-000000010060';
      const playgroupSectionId = '00000000-0000-4000-8000-000000010061';
      await classRepo.save(
        classRepo.create({
          id: playgroupId,
          name: 'Playgroup',
          numeric_grade: null,
          academic_year_id: SOURCE_YEAR_ID,
          tenant_id: TENANT_ID,
        }),
      );
      await sectionRepo.save(
        sectionRepo.create({
          id: playgroupSectionId,
          section_name: 'A',
          class_id: playgroupId,
          tenant_id: TENANT_ID,
        }),
      );

      // An unrelated null-grade class in the target year that must NOT be
      // picked as the retain class (e.g. "Nursery").
      const nurseryId = '00000000-0000-4000-8000-000000010062';
      const nurserySectionId = '00000000-0000-4000-8000-000000010063';
      await classRepo.save(
        classRepo.create({
          id: nurseryId,
          name: 'Nursery',
          numeric_grade: null,
          academic_year_id: TARGET_YEAR_ID,
          tenant_id: TENANT_ID,
        }),
      );
      await sectionRepo.save(
        sectionRepo.create({
          id: nurserySectionId,
          section_name: 'A',
          class_id: nurseryId,
          tenant_id: TENANT_ID,
        }),
      );

      // The chosen (explicit) target class for a promoted playgroup student.
      const targetForPlaygroupId = '00000000-0000-4000-8000-000000010064';
      const targetForPlaygroupSectionId = '00000000-0000-4000-8000-000000010065';
      await classRepo.save(
        classRepo.create({
          id: targetForPlaygroupId,
          name: 'Playgroup Next Year',
          numeric_grade: null,
          academic_year_id: TARGET_YEAR_ID,
          tenant_id: TENANT_ID,
        }),
      );
      await sectionRepo.save(
        sectionRepo.create({
          id: targetForPlaygroupSectionId,
          section_name: 'A',
          class_id: targetForPlaygroupId,
          tenant_id: TENANT_ID,
        }),
      );

      const playgroupExam = await examRepo.save(
        examRepo.create({
          tenant_id: TENANT_ID,
          academic_year_id: SOURCE_YEAR_ID,
          class_id: playgroupId,
          name: 'Playgroup Assessment',
          kind: ExamKind.TERM,
          status: ExamStatus.PUBLISHED,
        }),
      );

      const student = await buildStudent({
        registration_number: 'REG-PG',
        class_section_id: playgroupSectionId,
      });
      await enrollmentRepo.save(
        enrollmentRepo.create({
          student_id: student.id,
          class_id: playgroupId,
          section_id: playgroupSectionId,
          academic_year_id: SOURCE_YEAR_ID,
          tenant_id: TENANT_ID,
          enrollment_status: EnrollmentStatus.ACTIVE,
        }),
      );
      // Fails the exam → suggested_outcome RETAIN — this is the path that
      // exercises findRetainClass() inside commit().
      await resultRepo.save(
        resultRepo.create({
          tenant_id: TENANT_ID,
          exam_id: playgroupExam.id,
          student_id: student.id,
          total_marks: '100.00',
          gpa: '1.00',
          grade: 'F',
          is_fail: true,
          grading_scale_id: gradingScaleId,
          grading_scale_revision: 1,
          rule_version: 'v1',
          computed_at: new Date(),
        }),
      );

      const run = await service.create(
        {
          source_class_id: playgroupId,
          target_academic_year_id: TARGET_YEAR_ID,
          target_class_id: targetForPlaygroupId,
          exam_ids: [playgroupExam.id],
          algorithm: PlacementAlgorithm.BLOCK,
        },
        TENANT_ID,
        ADMIN_USER_ID,
      );

      const entry = await entryRepo.findOne({ where: { run_id: run.id, student_id: student.id } });
      expect(entry?.suggested_outcome).toBe(PromotionOutcome.RETAIN);

      // commit() must refuse — not silently retain the student into the
      // unrelated Nursery class.
      await expect(
        service.commit(run.id, TENANT_ID, ADMIN_USER_ID, 'ADMIN', { headers: {} }),
      ).rejects.toThrow(UnprocessableEntityException);

      // Confirm the student was never enrolled into Nursery.
      const wrongEnrollment = await enrollmentRepo.findOne({
        where: { student_id: student.id, class_id: nurseryId },
      });
      expect(wrongEnrollment).toBeNull();
    });
  });

  describe('tenant isolation', () => {
    it('never returns a run belonging to another tenant', async () => {
      const student = await buildStudent();
      await enrollActive(student.id);
      await addResult(student.id, { isFail: false, gpa: 4.0, total: 400 });

      const run = await service.create(
        {
          source_class_id: SOURCE_CLASS_ID,
          target_academic_year_id: TARGET_YEAR_ID,
          exam_ids: [examId],
          algorithm: PlacementAlgorithm.BLOCK,
        },
        TENANT_ID,
        ADMIN_USER_ID,
      );

      await expect(
        service.findOne(run.id, '00000000-0000-4000-8000-000000099999'),
      ).rejects.toThrow();
    });
  });
});
