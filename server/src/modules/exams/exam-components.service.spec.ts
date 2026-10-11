import { describe, it, expect, vi } from 'vitest';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ExamComponentsService } from './exam-components.service';
import { Exam } from './entities/exam.entity';
import { ExamComponent } from './entities/exam-component.entity';
import { Subject } from '../academics/entities/subject.entity';
import { AuditService } from '../audit/audit.service';
import { ExamComponentKind, ExamComponentSource, ExamStatus } from '@biddaloy/shared';
import { ResultsService } from './results.service';
import { Mark } from './entities/mark.entity';

/**
 * Unit tests for 19.3.1's `ExamComponentsService`: component validation
 * (pass_marks/full_marks, sequence uniqueness, the singular DERIVED
 * ATTENDANCE component) and the additive copy behaviour (issue rules #3/#5).
 */

const TENANT_ID = 'tenant-1';

function createComponentRepoStub(existing: ExamComponent[] = [], examRepo?: any, markRepo?: any) {
  const repo: any = {
    create: vi.fn((v: any) => v),
    save: vi.fn(async (v: any) => ({ id: `id-${Math.random()}`, ...v })),
    update: vi.fn(async () => undefined),
    softDelete: vi.fn(async () => undefined),
    find: vi.fn(async () => existing),
    findOne: vi.fn(async () => null),
  };
  repo.manager = {
    transaction: vi.fn(async (cb: any) =>
      cb({
        getRepository: (e: any) => (e === Exam ? examRepo : e === Mark ? markRepo : repo),
      }),
    ),
  };
  return repo;
}

function component(overrides: Partial<ExamComponent> = {}): ExamComponent {
  return {
    id: 'comp-1',
    tenant_id: TENANT_ID,
    exam_id: 'exam-1',
    subject_id: 'subj-1',
    name: 'Written',
    kind: ExamComponentKind.WRITTEN,
    source: ExamComponentSource.MANUAL,
    full_marks: '100',
    pass_marks: '33',
    sequence: 1,
    created_at: new Date(),
    updated_at: new Date(),
    deleted_at: null,
    ...overrides,
  } as ExamComponent;
}

async function buildService(existing: ExamComponent[] = [], status: ExamStatus = ExamStatus.DRAFT) {
  const examRepo = {
    findOne: vi.fn(async () => ({ id: 'exam-1', tenant_id: TENANT_ID, status })),
    update: vi.fn(async () => undefined),
  };
  const markRepo = { createQueryBuilder: vi.fn() };
  const maxMark = { value: null as string | null };
  markRepo.createQueryBuilder.mockReturnValue({
    select: () => ({
      where: () => ({
        andWhere: () => ({ getRawOne: async () => ({ max: maxMark.value }) }),
      }),
    }),
  });
  const resultsService = { recomputeProcessedExam: vi.fn(async () => 0) };
  const componentRepo = createComponentRepoStub(existing, examRepo, markRepo);
  // Default: any subject_id/target_subject_ids requested belongs to the
  // tenant — matches every existing test's fixture data, so only the
  // IDOR-guard-specific tests below need to override this.
  const subjectRepo: any = {
    findOne: vi.fn(async ({ where }: any) => ({ id: where.id, tenant_id: where.tenant_id })),
    find: vi.fn(async ({ where }: any) =>
      (where.id.value as string[]).map((id: string) => ({ id, tenant_id: TENANT_ID })),
    ),
  };
  const auditService = { record: vi.fn(async () => undefined) };

  const moduleRef = await Test.createTestingModule({
    providers: [
      ExamComponentsService,
      { provide: getRepositoryToken(Exam), useValue: examRepo },
      { provide: getRepositoryToken(ExamComponent), useValue: componentRepo },
      { provide: getRepositoryToken(Subject), useValue: subjectRepo },
      { provide: AuditService, useValue: auditService },
      { provide: ResultsService, useValue: resultsService },
    ],
  }).compile();

  return {
    maxMark,
    resultsService,
    service: moduleRef.get(ExamComponentsService),
    examRepo,
    componentRepo,
    subjectRepo,
    auditService,
  };
}

describe('ExamComponentsService validation (issue rules #2, #5)', () => {
  it('creates a valid component', async () => {
    const { service, componentRepo } = await buildService([]);

    const created = await service.create(
      'exam-1',
      {
        subject_id: 'subj-1',
        name: 'Written',
        kind: ExamComponentKind.WRITTEN,
        full_marks: '100',
        pass_marks: '33',
        sequence: 1,
      } as any,
      TENANT_ID,
    );

    expect(created).toMatchObject({ name: 'Written', tenant_id: TENANT_ID });
    expect(componentRepo.save).toHaveBeenCalled();
  });

  it('rejects pass_marks greater than full_marks', async () => {
    const { service } = await buildService([]);

    await expect(
      service.create(
        'exam-1',
        {
          subject_id: 'subj-1',
          name: 'Written',
          kind: ExamComponentKind.WRITTEN,
          full_marks: '50',
          pass_marks: '60',
          sequence: 1,
        } as any,
        TENANT_ID,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a duplicate sequence within the same exam-subject', async () => {
    const { service } = await buildService([component({ sequence: 1 })]);

    await expect(
      service.create(
        'exam-1',
        {
          subject_id: 'subj-1',
          name: 'MCQ',
          kind: ExamComponentKind.MCQ,
          full_marks: '50',
          sequence: 1,
        } as any,
        TENANT_ID,
      ),
    ).rejects.toThrow(ConflictException);
  });

  it('allows the same sequence number in a different exam-subject', async () => {
    // `find` is scoped by (exam_id, subject_id) in the service; a fresh
    // subject means no existing rows collide.
    const { service } = await buildService([]);

    await expect(
      service.create(
        'exam-1',
        {
          subject_id: 'subj-2',
          name: 'Written',
          kind: ExamComponentKind.WRITTEN,
          full_marks: '100',
          sequence: 1,
        } as any,
        TENANT_ID,
      ),
    ).resolves.toBeDefined();
  });

  it('rejects an ATTENDANCE component whose source is not DERIVED', async () => {
    const { service } = await buildService([]);

    await expect(
      service.create(
        'exam-1',
        {
          subject_id: 'subj-1',
          name: 'Attendance',
          kind: ExamComponentKind.ATTENDANCE,
          source: ExamComponentSource.MANUAL,
          full_marks: '10',
          sequence: 2,
        } as any,
        TENANT_ID,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a second ATTENDANCE component for the same exam-subject', async () => {
    const { service } = await buildService([
      component({
        kind: ExamComponentKind.ATTENDANCE,
        source: ExamComponentSource.DERIVED,
        sequence: 1,
      }),
    ]);

    await expect(
      service.create(
        'exam-1',
        {
          subject_id: 'subj-1',
          name: 'Attendance 2',
          kind: ExamComponentKind.ATTENDANCE,
          source: ExamComponentSource.DERIVED,
          full_marks: '10',
          sequence: 2,
        } as any,
        TENANT_ID,
      ),
    ).rejects.toThrow(ConflictException);
  });
});

describe('ExamComponentsService.copy (issue rule #3)', () => {
  it('copies every source component into an empty target subject', async () => {
    const sourceComponents = [
      component({ id: 's1', name: 'Written', sequence: 1 }),
      component({ id: 's2', name: 'MCQ', kind: ExamComponentKind.MCQ, sequence: 2 }),
    ];
    const { service, componentRepo } = await buildService([]);
    componentRepo.find = vi
      .fn()
      // First call: source components. Subsequent calls (per target): the
      // target subject's existing components — empty here.
      .mockResolvedValueOnce(sourceComponents)
      .mockResolvedValueOnce([]);

    const result = await service.copy(
      'exam-1',
      {
        source_exam_id: 'exam-1',
        source_subject_id: 'subj-1',
        target_subject_ids: ['subj-2'],
      } as any,
      TENANT_ID,
    );

    expect(result.copied).toEqual([
      { subject_id: 'subj-2', name: 'Written' },
      { subject_id: 'subj-2', name: 'MCQ' },
    ]);
    expect(result.skipped).toEqual([]);
    expect(componentRepo.save).toHaveBeenCalledTimes(2);
  });

  it('skips and reports a collision instead of overwriting, and never duplicates', async () => {
    const sourceComponents = [component({ id: 's1', name: 'Written', sequence: 1 })];
    const targetExisting = [
      component({ id: 't1', subject_id: 'subj-2', name: 'Written', sequence: 1 }),
    ];
    const { service, componentRepo } = await buildService([]);
    componentRepo.find = vi
      .fn()
      .mockResolvedValueOnce(sourceComponents)
      .mockResolvedValueOnce(targetExisting);

    const result = await service.copy(
      'exam-1',
      {
        source_exam_id: 'exam-1',
        source_subject_id: 'subj-1',
        target_subject_ids: ['subj-2'],
      } as any,
      TENANT_ID,
    );

    expect(result.copied).toEqual([]);
    expect(result.skipped).toEqual([
      {
        subject_id: 'subj-2',
        name: 'Written',
        reason: 'A component with this name already exists for this exam-subject.',
      },
    ]);
    expect(componentRepo.save).not.toHaveBeenCalled();
  });

  it('copies the same subject across exams (source_exam_id different from target exam)', async () => {
    const sourceComponents = [
      component({
        id: 's1',
        exam_id: 'exam-2',
        name: 'Viva',
        kind: ExamComponentKind.VIVA,
        sequence: 1,
      }),
    ];
    const { service, componentRepo } = await buildService([]);
    componentRepo.find = vi.fn().mockResolvedValueOnce(sourceComponents).mockResolvedValueOnce([]);

    const result = await service.copy(
      'exam-1',
      {
        source_exam_id: 'exam-2',
        source_subject_id: 'subj-1',
        target_subject_ids: ['subj-1'],
      } as any,
      TENANT_ID,
    );

    expect(result.copied).toEqual([{ subject_id: 'subj-1', name: 'Viva' }]);
  });

  it("rejects a target_subject_id that doesn't belong to the tenant (IDOR)", async () => {
    const { service, subjectRepo } = await buildService([]);
    subjectRepo.find = vi.fn(async () => []);

    await expect(
      service.copy(
        'exam-1',
        {
          source_exam_id: 'exam-1',
          source_subject_id: 'subj-1',
          target_subject_ids: ['other-tenant-subject'],
        } as any,
        TENANT_ID,
      ),
    ).rejects.toThrow(BadRequestException);
  });
});

describe('ExamComponentsService tenant-reference guard (IDOR)', () => {
  it("rejects a subject_id that doesn't belong to the tenant on create", async () => {
    const { service, subjectRepo } = await buildService([]);
    subjectRepo.findOne = vi.fn(async () => null);

    await expect(
      service.create(
        'exam-1',
        {
          subject_id: 'other-tenant-subject',
          name: 'Written',
          kind: ExamComponentKind.WRITTEN,
          full_marks: '100',
          sequence: 1,
        } as any,
        TENANT_ID,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a duplicate component name within the same exam-subject', async () => {
    const { service } = await buildService([component({ name: 'Written', sequence: 1 })]);

    await expect(
      service.create(
        'exam-1',
        {
          subject_id: 'subj-1',
          name: 'Written',
          kind: ExamComponentKind.MCQ,
          full_marks: '50',
          sequence: 2,
        } as any,
        TENANT_ID,
      ),
    ).rejects.toThrow(ConflictException);
  });
});

describe('ExamComponentsService published/processed guard (ACAD-05)', () => {
  const createDto = {
    subject_id: 'subj-1',
    name: 'Written',
    kind: ExamComponentKind.WRITTEN,
    full_marks: '100',
    sequence: 1,
  } as any;
  const copyDto = {
    source_exam_id: 'exam-1',
    source_subject_id: 'subj-1',
    target_subject_ids: ['subj-2'],
  } as any;

  it.each([
    ['create', (s: ExamComponentsService) => s.create('exam-1', createDto, TENANT_ID)],
    ['update', (s: ExamComponentsService) => s.update('exam-1', 'c1', { name: 'X' }, TENANT_ID)],
    ['remove', (s: ExamComponentsService) => s.remove('exam-1', 'c1', TENANT_ID)],
    ['copy', (s: ExamComponentsService) => s.copy('exam-1', copyDto, TENANT_ID)],
  ])('%s on a PUBLISHED exam is a 409 EXAM_PUBLISHED', async (_n, call) => {
    const { service, componentRepo } = await buildService([], ExamStatus.PUBLISHED);
    componentRepo.findOne = vi.fn(async () => component({ id: 'c1' }));
    await expect(call(service)).rejects.toMatchObject({
      response: { details: { code: 'EXAM_PUBLISHED' } },
    });
    expect(componentRepo.save).not.toHaveBeenCalled();
    expect(componentRepo.update).not.toHaveBeenCalled();
    expect(componentRepo.softDelete).not.toHaveBeenCalled();
  });

  it('rejects full_marks below the highest entered mark', async () => {
    const { service, componentRepo, maxMark } = await buildService();
    componentRepo.findOne = vi.fn(async () => component({ id: 'c1', pass_marks: null }));
    maxMark.value = '24';
    const err = await service
      .update('exam-1', 'c1', { full_marks: '20' }, TENANT_ID)
      .catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.getResponse().details.code).toBe('FULL_MARKS_BELOW_ENTERED');
    expect(componentRepo.update).not.toHaveBeenCalled();
  });

  it('recomputes in the same transaction on a PROCESSED exam', async () => {
    const { service, componentRepo, resultsService } = await buildService([], ExamStatus.PROCESSED);
    componentRepo.findOne = vi.fn(async () => component({ id: 'c1' }));
    await service.update('exam-1', 'c1', { full_marks: '80' }, TENANT_ID, 'u1');
    expect(resultsService.recomputeProcessedExam).toHaveBeenCalledTimes(1);
    expect(componentRepo.manager.transaction).toHaveBeenCalled();
  });

  it('#2246: a new MANUAL part on a PROCESSED exam sends it back to DRAFT, no recompute', async () => {
    const { service, examRepo, resultsService, auditService } = await buildService(
      [],
      ExamStatus.PROCESSED,
    );
    await service.create(
      'exam-1',
      {
        subject_id: 'subj-1',
        name: 'Practical',
        kind: ExamComponentKind.PRACTICAL,
        full_marks: '25',
        sequence: 2,
      } as any,
      TENANT_ID,
      'u1',
    );
    // Recomputing would store the empty part as ABSENT for everyone, ready to publish.
    expect(resultsService.recomputeProcessedExam).not.toHaveBeenCalled();
    expect(examRepo.update).toHaveBeenCalledWith(
      { id: 'exam-1', tenant_id: TENANT_ID },
      { status: ExamStatus.DRAFT },
    );
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        entity_type: 'Exam',
        new_values: { status: ExamStatus.DRAFT, reason: 'COMPONENT_ADDED' },
      }),
      expect.anything(),
    );
  });

  it('a new DERIVED part on a PROCESSED exam just recomputes (it is never blank)', async () => {
    const { service, examRepo, resultsService } = await buildService([], ExamStatus.PROCESSED);
    await service.create(
      'exam-1',
      {
        subject_id: 'subj-1',
        name: 'Attendance',
        kind: ExamComponentKind.ATTENDANCE,
        source: ExamComponentSource.DERIVED,
        full_marks: '5',
        sequence: 2,
      } as any,
      TENANT_ID,
      'u1',
    );
    expect(resultsService.recomputeProcessedExam).toHaveBeenCalledTimes(1);
    expect(examRepo.update).not.toHaveBeenCalled();
  });

  it('does not recompute on a DRAFT exam', async () => {
    const { service, componentRepo, resultsService } = await buildService();
    componentRepo.findOne = vi.fn(async () => component({ id: 'c1' }));
    await service.update('exam-1', 'c1', { full_marks: '80' }, TENANT_ID);
    expect(resultsService.recomputeProcessedExam).not.toHaveBeenCalled();
  });
});
