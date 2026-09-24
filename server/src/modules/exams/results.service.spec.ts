import { describe, it, expect, vi } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ResultsService } from './results.service';
import { Exam } from './entities/exam.entity';
import { Result } from './entities/result.entity';
import { ResultSubject } from './entities/result-subject.entity';
import { Mark } from './entities/mark.entity';
import { ExamComponent } from './entities/exam-component.entity';
import { ClassSubject } from '../academics/entities/class-subject.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { Student } from '../students/entities/student.entity';
import { StudentSubjectChoice } from '../students/entities/student-subject-choice.entity';
import { GradingScale } from '../grading/entities/grading-scale.entity';
import { GradingBand } from '../grading/entities/grading-band.entity';
import { AttendanceComponentService } from './attendance-component.service';
import { MarkGridService } from './mark-grid.service';
import { AuditService } from '../audit/audit.service';
import { ExamComponentKind, ExamComponentSource, ExamStatus, MarkStatus } from '@biddaloy/shared';

const TENANT_ID = 'tenant-1';
const EXAM_ID = 'exam-1';
const CLASS_ID = 'class-1';
const YEAR_ID = 'year-1';
const SECTION_ID = 'section-1';
const SUBJECT_ID = 'subject-1';
const SCALE_ID = 'scale-1';
const COMPONENT_ID = 'comp-1';

const NCTB_BAND_ROWS = [
  { percent_from: 80, percent_to: 100, grade: 'A+', gpa: '5.00', is_fail: false },
  { percent_from: 70, percent_to: 79, grade: 'A', gpa: '4.00', is_fail: false },
  { percent_from: 33, percent_to: 69, grade: 'B', gpa: '3.00', is_fail: false },
  { percent_from: 0, percent_to: 32, grade: 'F', gpa: '0.00', is_fail: true },
];

function makeRepos(overrides: Record<string, any> = {}) {
  const exam = {
    id: EXAM_ID,
    tenant_id: TENANT_ID,
    class_id: CLASS_ID,
    academic_year_id: YEAR_ID,
    academic_term_id: null,
    status: ExamStatus.DRAFT,
    ...overrides.exam,
  };

  const examRepo: any = {
    findOne: vi.fn(async () => exam),
    manager: {
      transaction: vi.fn(async (cb: any) =>
        cb({
          getRepository: (entity: any) => {
            if (entity === Exam) return examRepo;
            if (entity === Result) return resultRepo;
            if (entity === ResultSubject) return resultSubjectRepo;
            return { update: vi.fn(async () => undefined) };
          },
        }),
      ),
      getRepository: (entity: any) => (entity === Exam ? examRepo : resultRepo),
    },
    update: vi.fn(async () => undefined),
  };

  const resultRepo: any = {
    create: vi.fn((v: any) => v),
    save: vi.fn(async (v: any) => ({ id: `result-${Math.random()}`, ...v })),
    find: vi.fn(async () => overrides.existingResults ?? []),
    softDelete: vi.fn(async () => undefined),
    update: vi.fn(async () => undefined),
    manager: {
      transaction: vi.fn(async (cb: any) =>
        cb({
          getRepository: (entity: any) => {
            if (entity === Result) return resultRepo;
            if (entity === ResultSubject) return resultSubjectRepo;
            if (entity === Exam) return examRepo;
            return {};
          },
        }),
      ),
    },
  };
  examRepo.manager.getRepository = (entity: any) => (entity === Exam ? examRepo : resultRepo);

  const resultSubjectRepo: any = {
    create: vi.fn((v: any) => v),
    save: vi.fn(async (v: any) => ({ id: `rs-${Math.random()}`, ...v })),
    softDelete: vi.fn(async () => undefined),
  };

  const sectionRepo: any = {
    find: vi.fn(async () => overrides.sections ?? [{ id: SECTION_ID, class_id: CLASS_ID }]),
  };
  const studentRepo: any = {
    find: vi.fn(
      async () =>
        overrides.students ?? [
          { id: 'stu-1', class_section_id: SECTION_ID, roll_number: 1 },
          { id: 'stu-2', class_section_id: SECTION_ID, roll_number: 2 },
        ],
    ),
  };
  const classSubjectRepo: any = {
    find: vi.fn(
      async () =>
        overrides.classSubjects ?? [
          {
            id: 'cs-1',
            class_id: CLASS_ID,
            subject_id: SUBJECT_ID,
            academic_year_id: YEAR_ID,
            is_optional: false,
            is_graded_only: false,
          },
        ],
    ),
  };
  const choiceRepo: any = { find: vi.fn(async () => overrides.choices ?? []) };
  const componentRepo: any = {
    find: vi.fn(
      async () =>
        overrides.components ?? [
          {
            id: COMPONENT_ID,
            exam_id: EXAM_ID,
            subject_id: SUBJECT_ID,
            kind: ExamComponentKind.WRITTEN,
            source: ExamComponentSource.MANUAL,
            full_marks: '100',
          },
        ],
    ),
  };
  const markRepo: any = { find: vi.fn(async () => overrides.marks ?? []) };
  const scaleRepo: any = {
    find: vi.fn(
      async () =>
        overrides.scales ?? [
          {
            id: SCALE_ID,
            tenant_id: TENANT_ID,
            academic_year_id: YEAR_ID,
            class_id: null,
            revision: 1,
          },
        ],
    ),
  };
  const bandRepo: any = { find: vi.fn(async () => overrides.bands ?? NCTB_BAND_ROWS) };

  const attendanceComponentService = {
    computeForSection: vi.fn(async () => ({ reason: null, valuesByStudent: new Map() })),
  };
  const gridService = {
    progress: vi.fn(async () => ({ counts: {}, outstanding: overrides.outstanding ?? [] })),
  };
  const auditService = { record: vi.fn(async () => undefined) };

  return {
    exam,
    examRepo,
    resultRepo,
    resultSubjectRepo,
    sectionRepo,
    studentRepo,
    classSubjectRepo,
    choiceRepo,
    componentRepo,
    markRepo,
    scaleRepo,
    bandRepo,
    attendanceComponentService,
    gridService,
    auditService,
  };
}

async function buildService(overrides: Record<string, any> = {}) {
  const repos = makeRepos(overrides);

  const moduleRef = await Test.createTestingModule({
    providers: [
      ResultsService,
      { provide: getRepositoryToken(Exam), useValue: repos.examRepo },
      { provide: getRepositoryToken(Result), useValue: repos.resultRepo },
      { provide: getRepositoryToken(ResultSubject), useValue: repos.resultSubjectRepo },
      { provide: getRepositoryToken(Mark), useValue: repos.markRepo },
      { provide: getRepositoryToken(ExamComponent), useValue: repos.componentRepo },
      { provide: getRepositoryToken(ClassSubject), useValue: repos.classSubjectRepo },
      { provide: getRepositoryToken(ClassSection), useValue: repos.sectionRepo },
      { provide: getRepositoryToken(Student), useValue: repos.studentRepo },
      { provide: getRepositoryToken(StudentSubjectChoice), useValue: repos.choiceRepo },
      { provide: getRepositoryToken(GradingScale), useValue: repos.scaleRepo },
      { provide: getRepositoryToken(GradingBand), useValue: repos.bandRepo },
      { provide: AttendanceComponentService, useValue: repos.attendanceComponentService },
      { provide: MarkGridService, useValue: repos.gridService },
      { provide: AuditService, useValue: repos.auditService },
    ],
  }).compile();

  return { service: moduleRef.get(ResultsService), ...repos };
}

describe('ResultsService.process', () => {
  it('refuses to process while any grid is not SUBMITTED', async () => {
    const { service } = await buildService({
      outstanding: [
        { section_id: SECTION_ID, subject_id: SUBJECT_ID, section_name: 'A', state: 'DRAFT' },
      ],
    });

    await expect(service.process(EXAM_ID, TENANT_ID, 'user-1')).rejects.toThrow(ConflictException);
  });

  it("computes and stores every enrolled student's result, moving the exam to PROCESSED", async () => {
    const { service, resultRepo, resultSubjectRepo, examRepo, markRepo } = await buildService({
      marks: [
        {
          student_id: 'stu-1',
          component_id: COMPONENT_ID,
          value: '85.00',
          status: MarkStatus.PRESENT,
        },
        {
          student_id: 'stu-2',
          component_id: COMPONENT_ID,
          value: '40.00',
          status: MarkStatus.PRESENT,
        },
      ],
    });

    const result = await service.process(EXAM_ID, TENANT_ID, 'user-1');

    expect(result.processed).toBe(2);
    expect(resultRepo.save).toHaveBeenCalledTimes(2);
    expect(resultSubjectRepo.save).toHaveBeenCalledTimes(2);
    expect(examRepo.manager.getRepository(Exam).update).toHaveBeenCalledWith(
      { id: EXAM_ID, tenant_id: TENANT_ID },
      { status: ExamStatus.PROCESSED },
    );
    // stu-1 at 85% (A+) outranks stu-2 at 40% (B) — position ties aren't
    // exercised here (see the dedicated rankByGpa unit tests), just that
    // process() actually calls through to real grading.
    expect(markRepo.find).toHaveBeenCalled();
  });

  it('a forced process is audited with forced: true', async () => {
    const { service, auditService } = await buildService({
      outstanding: [
        { section_id: SECTION_ID, subject_id: SUBJECT_ID, section_name: 'A', state: 'DRAFT' },
      ],
      marks: [],
    });

    await service.process(EXAM_ID, TENANT_ID, 'user-1', true);

    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        new_values: expect.objectContaining({ forced: true }),
      }),
      expect.anything(),
    );
  });

  it('refuses to process an already-published exam', async () => {
    const { service } = await buildService({ exam: { status: ExamStatus.PUBLISHED } });

    await expect(service.process(EXAM_ID, TENANT_ID, 'user-1')).rejects.toThrow(ConflictException);
  });
});

describe('ResultsService.recomputeIfProcessed (D18 step 6)', () => {
  it('recomputes when the exam is PROCESSED', async () => {
    const { service, resultRepo } = await buildService({
      exam: { status: ExamStatus.PROCESSED },
      marks: [
        {
          student_id: 'stu-1',
          component_id: COMPONENT_ID,
          value: '85.00',
          status: MarkStatus.PRESENT,
        },
      ],
    });

    await service.recomputeIfProcessed(EXAM_ID, ['stu-1'], TENANT_ID, 'user-1');

    expect(resultRepo.save).toHaveBeenCalled();
  });

  it('is a no-op once PUBLISHED — marks are frozen', async () => {
    const { service, resultRepo } = await buildService({ exam: { status: ExamStatus.PUBLISHED } });

    await service.recomputeIfProcessed(EXAM_ID, ['stu-1'], TENANT_ID, 'user-1');

    expect(resultRepo.save).not.toHaveBeenCalled();
  });

  it('removes a stale result for a student no longer computed (e.g. made INACTIVE) — pr-fix #945', async () => {
    const { service, resultRepo } = await buildService({
      exam: { status: ExamStatus.PROCESSED },
      existingResults: [
        { id: 'result-stu-1', student_id: 'stu-1' },
        { id: 'result-gone', student_id: 'stu-gone' },
      ],
    });

    await service.recomputeIfProcessed(EXAM_ID, ['stu-1'], TENANT_ID, 'user-1');

    // Looked up by exam, not by the recomputed students' IDs — so the
    // student who dropped out of computeAll has their old row removed too,
    // instead of it surviving to be published and texted.
    expect(resultRepo.find).toHaveBeenCalledWith({
      where: { exam_id: EXAM_ID, tenant_id: TENANT_ID, deleted_at: expect.anything() },
    });
    expect(resultRepo.softDelete).toHaveBeenCalledWith({
      id: expect.objectContaining({ value: ['result-stu-1', 'result-gone'] }),
      tenant_id: TENANT_ID,
    });
  });

  it('re-checks status under the exam lock — a publish that landed first makes it a no-op (pr-fix #945)', async () => {
    const { service, examRepo, resultRepo } = await buildService({
      exam: { status: ExamStatus.PROCESSED },
    });
    // The locked read (inside the transaction) sees the publish that
    // committed while this request was on its way in.
    examRepo.findOne = vi.fn(async () => ({
      id: EXAM_ID,
      tenant_id: TENANT_ID,
      class_id: CLASS_ID,
      academic_year_id: YEAR_ID,
      status: ExamStatus.PUBLISHED,
    }));

    await service.recomputeIfProcessed(EXAM_ID, ['stu-1'], TENANT_ID, 'user-1');

    expect(examRepo.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ lock: { mode: 'pessimistic_write' } }),
    );
    expect(resultRepo.softDelete).not.toHaveBeenCalled();
    expect(resultRepo.save).not.toHaveBeenCalled();
  });

  it('is a no-op while still DRAFT — nothing computed yet', async () => {
    const { service, resultRepo } = await buildService({ exam: { status: ExamStatus.DRAFT } });

    await service.recomputeIfProcessed(EXAM_ID, ['stu-1'], TENANT_ID, 'user-1');

    expect(resultRepo.save).not.toHaveBeenCalled();
  });
});

describe('ResultsService.publish / reopen', () => {
  it('publish moves PROCESSED -> PUBLISHED and stamps published_at', async () => {
    const { service, examRepo, resultRepo } = await buildService({
      exam: { status: ExamStatus.PROCESSED },
    });

    await service.publish(EXAM_ID, TENANT_ID, 'admin-1');

    expect(examRepo.manager.getRepository(Exam).update).toHaveBeenCalledWith(
      { id: EXAM_ID, tenant_id: TENANT_ID },
      expect.objectContaining({ status: ExamStatus.PUBLISHED }),
    );
    expect(resultRepo.update).toHaveBeenCalledWith(
      { exam_id: EXAM_ID, tenant_id: TENANT_ID },
      expect.objectContaining({ published_at: expect.any(Date) }),
    );
  });

  it('publish re-checks status under the exam lock, refusing if it changed since the first read (pr-fix #945)', async () => {
    const { service, examRepo, resultRepo } = await buildService({
      exam: { status: ExamStatus.PROCESSED },
    });
    const base = {
      id: EXAM_ID,
      tenant_id: TENANT_ID,
      class_id: CLASS_ID,
      academic_year_id: YEAR_ID,
    };
    examRepo.findOne = vi
      .fn()
      .mockResolvedValueOnce({ ...base, status: ExamStatus.PROCESSED }) // unlocked pre-check
      .mockResolvedValueOnce({ ...base, status: ExamStatus.PUBLISHED }); // locked re-read

    await expect(service.publish(EXAM_ID, TENANT_ID, 'admin-1')).rejects.toThrow(ConflictException);
    expect(resultRepo.update).not.toHaveBeenCalled();
  });

  it('refuses to publish an exam that is not PROCESSED', async () => {
    const { service } = await buildService({ exam: { status: ExamStatus.DRAFT } });

    await expect(service.publish(EXAM_ID, TENANT_ID, 'admin-1')).rejects.toThrow(ConflictException);
  });

  it('reopen moves PUBLISHED -> PROCESSED and audits before/after', async () => {
    const { service, examRepo, auditService } = await buildService({
      exam: { status: ExamStatus.PUBLISHED },
    });

    await service.reopen(EXAM_ID, TENANT_ID, 'admin-1');

    expect(examRepo.manager.getRepository(Exam).update).toHaveBeenCalledWith(
      { id: EXAM_ID, tenant_id: TENANT_ID },
      { status: ExamStatus.PROCESSED, published_at: null },
    );
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        old_values: { status: ExamStatus.PUBLISHED },
        new_values: { status: ExamStatus.PROCESSED },
      }),
      expect.anything(),
    );
  });

  it('refuses to reopen an exam that is not published', async () => {
    const { service } = await buildService({ exam: { status: ExamStatus.PROCESSED } });

    await expect(service.reopen(EXAM_ID, TENANT_ID, 'admin-1')).rejects.toThrow(ConflictException);
  });
});
