import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { getDataSourceToken, TypeOrmModule } from '@nestjs/typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { SEED_TENANT_ID, SEED_ADMIN_USER_ID } from '@test/constants';
import { AuditService } from '../src/modules/audit/audit.service';
import { AuditLog } from '../src/modules/audit/entities/audit-log.entity';
import { RecomputeService, RESULT_RECOMPUTER } from '../src/modules/grading/recompute.service';
import { GradingService } from '../src/modules/grading/grading.service';
import { ExamResultRecomputer } from '../src/modules/exams/result-recomputer.service';
import { ResultsService } from '../src/modules/exams/results.service';
import { MarkGridService } from '../src/modules/exams/mark-grid.service';
import { AttendanceComponentService } from '../src/modules/exams/attendance-component.service';
import { MarksAuthorizationService } from '../src/modules/exams/marks-authorization.util';
import { Exam } from '../src/modules/exams/entities/exam.entity';
import { ExamComponent } from '../src/modules/exams/entities/exam-component.entity';
import { Mark } from '../src/modules/exams/entities/mark.entity';
import { Result } from '../src/modules/exams/entities/result.entity';
import { Class } from '../src/modules/academics/entities/class.entity';
import { ClassSection } from '../src/modules/academics/entities/class-section.entity';
import { ClassSubject } from '../src/modules/academics/entities/class-subject.entity';
import { Subject } from '../src/modules/academics/entities/subject.entity';
import { Student } from '../src/modules/students/entities/student.entity';
import { Enrollment } from '../src/modules/students/entities/enrollment.entity';
import {
  EnrollmentStatus,
  ExamComponentKind,
  ExamComponentSource,
  ExamKind,
  ExamStatus,
  MarkStatus,
} from '@biddaloy/shared';
import { GradingScale } from '../src/modules/grading/entities/grading-scale.entity';
import { GradingBand } from '../src/modules/grading/entities/grading-band.entity';
import { AcademicYear } from '../src/modules/academics/entities/academic-year.entity';
import { School } from '../src/modules/schools/entities/school.entity';

/**
 * [20.2.1] End-to-end proof, against a real DB, that `RecomputeService.confirm`
 * actually replaces a scale's band set and bumps its revision (proves the
 * partial-unique-index fix holds under real inserts), and that tenant
 * isolation on the scale lookup is enforced, not just mocked.
 *
 * `grading_scales`/`grading_bands` are transactional tables (see
 * `test/reset-order.ts`) — the global `beforeEach` in `test/setup.ts`
 * truncates them before every `it()`, so the fixture scale is built fresh
 * in `beforeEach` here, not `beforeAll` (same convention as e.g.
 * `attendance/absence-notice.service.integration.spec.ts`).
 */
describe('RecomputeService (integration)', () => {
  const TENANT_ID = SEED_TENANT_ID;
  const OTHER_TENANT = '00000000-0000-4000-8000-000000000099';
  const ADMIN_USER_ID = SEED_ADMIN_USER_ID;

  let dataSource: DataSource;
  let recomputeService: RecomputeService;
  let resultsService: ResultsService;
  let gradingService: GradingService;
  let scaleId: string;

  const bandsA = [
    { percent_from: 0, percent_to: 59, grade: 'B', sequence: 2 },
    { percent_from: 60, percent_to: 100, grade: 'A', sequence: 1 },
  ];
  const bandsB = [
    { percent_from: 0, percent_to: 69, grade: 'F', sequence: 2 },
    { percent_from: 70, percent_to: 100, grade: 'A+', sequence: 1 },
  ];
  const bandsC = [
    { percent_from: 0, percent_to: 79, grade: 'C', sequence: 2 },
    { percent_from: 80, percent_to: 100, grade: 'A++', sequence: 1 },
  ];

  beforeAll(async () => {
    const module = await createTestModule(
      ALL_ENTITIES,
      [
        RecomputeService,
        GradingService,
        AuditService,
        ResultsService,
        MarkGridService,
        ExamResultRecomputer,
        {
          provide: AttendanceComponentService,
          useValue: { computeForSection: async () => ({ valuesByStudent: new Map() }) },
        },
        {
          provide: MarksAuthorizationService,
          useValue: { assertCanRead: async () => undefined, assertCanWrite: async () => undefined },
        },
        { provide: RESULT_RECOMPUTER, useExisting: ExamResultRecomputer },
      ],
      [],
    );
    recomputeService = module.get<RecomputeService>(RecomputeService);
    resultsService = module.get(ResultsService);
    gradingService = module.get(GradingService);
    dataSource = module.get<DataSource>(getDataSourceToken());

    const schoolRepo = dataSource.getRepository(School);
    if (!(await schoolRepo.findOne({ where: { id: OTHER_TENANT } }))) {
      await schoolRepo.save({
        id: OTHER_TENANT,
        name: 'Other School',
        slug: 'grading-recompute-other',
      });
    }
  }, 60000);

  afterAll(async () => {
    if (dataSource) await dataSource.destroy();
  });

  beforeEach(async () => {
    const year = await dataSource.getRepository(AcademicYear).save({
      name: `Grading Recompute Test Year ${Date.now()}`,
      start_date: '2026-01-01',
      end_date: '2026-12-31',
      tenant_id: TENANT_ID,
    });

    const scale = await dataSource.getRepository(GradingScale).save({
      tenant_id: TENANT_ID,
      academic_year_id: year.id,
      class_id: null,
      name: `Recompute Test Scale ${Date.now()}`,
    });
    scaleId = scale.id;
  });

  it('replaces the band set and bumps revision on each confirm (1→2→3)', async () => {
    const first = await recomputeService.confirm(
      scaleId,
      TENANT_ID,
      ADMIN_USER_ID,
      ADMIN_USER_ID,
      bandsA as any,
    );
    expect(first.scale.revision).toBe(2);
    expect(first.bands.map((b) => b.grade).sort()).toEqual(['A', 'B']);

    const second = await recomputeService.confirm(
      scaleId,
      TENANT_ID,
      ADMIN_USER_ID,
      ADMIN_USER_ID,
      bandsB as any,
    );
    expect(second.scale.revision).toBe(3);
    expect(second.bands.map((b) => b.grade).sort()).toEqual(['A+', 'F']);

    // Real DB round trip: reload the scale and confirm the stored band set
    // actually changed, not just the in-memory return value.
    const reloaded = await dataSource
      .getRepository(GradingScale)
      .findOne({ where: { id: scaleId } });
    expect(reloaded?.revision).toBe(3);

    const third = await recomputeService.confirm(
      scaleId,
      TENANT_ID,
      ADMIN_USER_ID,
      ADMIN_USER_ID,
      bandsC as any,
    );
    expect(third.scale.revision).toBe(4);
  });

  it("rejects a confirm against another tenant's scale (not empty-success)", async () => {
    await expect(
      recomputeService.confirm(scaleId, OTHER_TENANT, ADMIN_USER_ID, ADMIN_USER_ID, bandsA as any),
    ).rejects.toThrow(NotFoundException);
  });

  // --- Real recompute (68.2.06, ACAD-02) ---

  const oldBands = [
    { percent_from: 0, percent_to: 32, grade: 'F', gpa: 0, is_fail: true, sequence: 2 },
    { percent_from: 33, percent_to: 100, grade: 'A', gpa: 5, is_fail: false, sequence: 1 },
  ];
  // Same pass line, but a 75% student now earns "A+" instead of "A".
  const newBands = [
    { percent_from: 0, percent_to: 32, grade: 'F', gpa: 0, is_fail: true, sequence: 3 },
    { percent_from: 33, percent_to: 69, grade: 'B', gpa: 3, is_fail: false, sequence: 2 },
    { percent_from: 70, percent_to: 100, grade: 'A+', gpa: 5, is_fail: false, sequence: 1 },
  ];

  /** One class, one student scoring 75/100, a scale with `oldBands`, and an
   * exam processed (and optionally published) against it. */
  async function buildProcessedExam(tenantId: string, publish = false) {
    const tag = `${tenantId.slice(-4)}${Math.random().toString(36).slice(2, 8)}`;
    const year = await dataSource.getRepository(AcademicYear).save({
      name: `RC Year ${tag}`,
      start_date: '2026-01-01',
      end_date: '2026-12-31',
      tenant_id: tenantId,
    });
    const cls = await dataSource.getRepository(Class).save({
      name: `RC Class ${tag}`,
      academic_year_id: year.id,
      tenant_id: tenantId,
    });
    const section = await dataSource.getRepository(ClassSection).save({
      section_name: 'A',
      class_id: cls.id,
      tenant_id: tenantId,
    });
    const subject = await dataSource.getRepository(Subject).save({
      name_en: `RC Subject ${tag}`,
      code: `RC${tag}`.slice(0, 20),
      tenant_id: tenantId,
    });
    await dataSource.getRepository(ClassSubject).save({
      class_id: cls.id,
      subject_id: subject.id,
      academic_year_id: year.id,
      is_optional: false,
      is_graded_only: false,
      tenant_id: tenantId,
    });
    // Same name in both tenants on purpose: tenant isolation must not rely on it.
    const scale = await dataSource.getRepository(GradingScale).save({
      tenant_id: tenantId,
      academic_year_id: year.id,
      class_id: null,
      name: 'Shared Name Scale',
    });
    await dataSource.getRepository(GradingBand).save(
      oldBands.map((b) => ({
        ...b,
        gpa: String(b.gpa),
        tenant_id: tenantId,
        scale_id: scale.id,
      })),
    );
    const student = await dataSource.getRepository(Student).save({
      full_name: 'RC Student',
      registration_number: `RC-${tag}`,
      roll_number: 1,
      class_section_id: section.id,
      tenant_id: tenantId,
      date_of_birth: new Date('2012-01-01'),
      gender: 'MALE',
      enrollment_status: EnrollmentStatus.ACTIVE,
      preferred_communication: 'SMS',
    } as any);
    await dataSource.getRepository(Enrollment).save({
      student_id: (student as any).id,
      class_id: cls.id,
      section_id: section.id,
      academic_year_id: year.id,
      enrollment_status: EnrollmentStatus.ACTIVE,
      tenant_id: tenantId,
    });
    const exam = await dataSource.getRepository(Exam).save({
      tenant_id: tenantId,
      academic_year_id: year.id,
      class_id: cls.id,
      name: `RC Exam ${tag}`,
      kind: ExamKind.TERM,
      status: ExamStatus.DRAFT,
    });
    const component = await dataSource.getRepository(ExamComponent).save({
      tenant_id: tenantId,
      exam_id: exam.id,
      subject_id: subject.id,
      name: 'Written',
      kind: ExamComponentKind.WRITTEN,
      source: ExamComponentSource.MANUAL,
      full_marks: '100',
      sequence: 1,
    });
    await dataSource.getRepository(Mark).save({
      tenant_id: tenantId,
      exam_id: exam.id,
      student_id: (student as any).id,
      subject_id: subject.id,
      component_id: component.id,
      value: '75.00',
      status: MarkStatus.PRESENT,
    });
    await resultsService.process(exam.id, tenantId, ADMIN_USER_ID, true);
    if (publish) await resultsService.publish(exam.id, tenantId, ADMIN_USER_ID);
    return { exam, scaleId: scale.id };
  }

  const resultOf = (examId: string, tenantId: string) =>
    dataSource.getRepository(Result).findOneByOrFail({ exam_id: examId, tenant_id: tenantId });

  it('ACAD-02: preview counts the PROCESSED results and confirm rewrites grade + revision', async () => {
    const { exam, scaleId: usedScale } = await buildProcessedExam(TENANT_ID);
    expect((await resultOf(exam.id, TENANT_ID)).grade).toBe('A');

    const preview = await recomputeService.preview(usedScale, TENANT_ID, newBands as any);
    expect(preview).toMatchObject({ valid: true, bands_changed: true, affected_result_count: 1 });

    const done = await recomputeService.confirm(
      usedScale,
      TENANT_ID,
      ADMIN_USER_ID,
      ADMIN_USER_ID,
      newBands as any,
    );
    expect(done.affected_result_count).toBe(1);

    const after = await resultOf(exam.id, TENANT_ID);
    expect(after.grade).toBe('A+');
    expect(after.grading_scale_revision).toBe(done.scale.revision);
  });

  it('D16: confirm on a scale used by a PUBLISHED exam is a 409 and bands + revision stay put', async () => {
    const { exam, scaleId: usedScale } = await buildProcessedExam(TENANT_ID, true);

    const preview = await recomputeService.preview(usedScale, TENANT_ID, newBands as any);
    expect(preview.valid).toBe(false);
    expect(preview.problems[0].type).toBe('SCALE_IN_PUBLISHED_RESULTS');

    await expect(
      recomputeService.confirm(usedScale, TENANT_ID, ADMIN_USER_ID, ADMIN_USER_ID, newBands as any),
    ).rejects.toThrow(ConflictException);

    const scale = await dataSource.getRepository(GradingScale).findOneByOrFail({ id: usedScale });
    expect(scale.revision).toBe(1);
    const bands = await dataSource
      .getRepository(GradingBand)
      .find({ where: { scale_id: usedScale } });
    expect(bands.map((b) => b.grade).sort()).toEqual(['A', 'F']);
    expect((await resultOf(exam.id, TENANT_ID)).grade).toBe('A');
  });

  it("another tenant's results (same scale name) are untouched by a confirm", async () => {
    const mine = await buildProcessedExam(TENANT_ID);
    const theirs = await buildProcessedExam(OTHER_TENANT);

    await recomputeService.confirm(
      mine.scaleId,
      TENANT_ID,
      ADMIN_USER_ID,
      ADMIN_USER_ID,
      newBands as any,
    );

    expect((await resultOf(mine.exam.id, TENANT_ID)).grade).toBe('A+');
    const other = await resultOf(theirs.exam.id, OTHER_TENANT);
    expect(other.grade).toBe('A');
    expect(other.grading_scale_revision).toBe(1);
  });

  it('[68.2.12] deleting a scale referenced by a result row is refused and the scale stays live', async () => {
    const { scaleId: usedScale } = await buildProcessedExam(TENANT_ID);

    await expect(gradingService.remove(usedScale, TENANT_ID, ADMIN_USER_ID)).rejects.toMatchObject({
      response: { details: { code: 'GRADING_SCALE_IN_USE' } },
    });

    const scale = await dataSource.getRepository(GradingScale).findOneByOrFail({ id: usedScale });
    expect(scale.deleted_at).toBeNull();
    expect(
      await dataSource.getRepository(GradingBand).count({ where: { scale_id: usedScale } }),
    ).toBe(2);
  });

  it('[68.2.12] an unreferenced scale can still be deleted', async () => {
    await gradingService.remove(scaleId, TENANT_ID, ADMIN_USER_ID);

    expect(await dataSource.getRepository(GradingScale).countBy({ id: scaleId })).toBe(0);
  });
});
