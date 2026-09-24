import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NotFoundException, ConflictException, UnprocessableEntityException } from '@nestjs/common';
import { PromotionRunStatus, PlacementAlgorithm, PromotionOutcome } from '@biddaloy/shared';
import { PromotionsService } from './promotions.service';

/**
 * Unit tests against mocked repositories — covers validation branches that
 * are cheap to hit without a database (missing class, bad exam ids,
 * DRAFT-only guards). Full end-to-end behavior (placement, commit
 * atomicity, approval-gating) is in promotions.service.integration.spec.ts.
 */
function makeRepo() {
  return {
    findOne: vi.fn(),
    find: vi.fn().mockResolvedValue([]),
    save: vi.fn(),
    create: vi.fn((x) => x),
    delete: vi.fn(),
    update: vi.fn(),
    manager: {
      transaction: vi.fn(async (cb: (manager: unknown) => unknown) => cb(fakeManager())),
    },
  };
}

function fakeManager() {
  const repo = makeRepo();
  return { getRepository: () => repo };
}

describe('PromotionsService (unit)', () => {
  let service: PromotionsService;
  let runRepo: ReturnType<typeof makeRepo>;
  let entryRepo: ReturnType<typeof makeRepo>;
  let classRepo: ReturnType<typeof makeRepo>;
  let sectionRepo: ReturnType<typeof makeRepo>;
  let examRepo: ReturnType<typeof makeRepo>;
  let resultRepo: ReturnType<typeof makeRepo>;
  let studentRepo: ReturnType<typeof makeRepo>;
  let enrollmentRepo: ReturnType<typeof makeRepo>;
  let academicYearRepo: ReturnType<typeof makeRepo>;
  let userRepo: ReturnType<typeof makeRepo>;
  let enrollmentService: { createInTransaction: ReturnType<typeof vi.fn> };
  let auditService: { record: ReturnType<typeof vi.fn> };
  let approvalService: { consume: ReturnType<typeof vi.fn> };

  const TENANT_ID = 'tenant-1';

  beforeEach(() => {
    runRepo = makeRepo();
    entryRepo = makeRepo();
    classRepo = makeRepo();
    sectionRepo = makeRepo();
    examRepo = makeRepo();
    resultRepo = makeRepo();
    studentRepo = makeRepo();
    enrollmentRepo = makeRepo();
    academicYearRepo = makeRepo();
    userRepo = makeRepo();
    enrollmentService = { createInTransaction: vi.fn() };
    auditService = { record: vi.fn() };
    approvalService = { consume: vi.fn() };

    service = new PromotionsService(
      runRepo as any,
      entryRepo as any,
      classRepo as any,
      sectionRepo as any,
      examRepo as any,
      resultRepo as any,
      studentRepo as any,
      enrollmentRepo as any,
      academicYearRepo as any,
      userRepo as any,
      enrollmentService as any,
      auditService as any,
      approvalService as any,
    );
  });

  describe('create', () => {
    it('throws NotFoundException when the source class does not exist', async () => {
      classRepo.findOne.mockResolvedValue(null);

      await expect(
        service.create(
          {
            source_class_id: 'missing-class',
            target_academic_year_id: 'year-2',
            exam_ids: ['exam-1'],
            algorithm: PlacementAlgorithm.BLOCK,
          },
          TENANT_ID,
          'user-1',
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws 422 when the target class cannot be picked (numeric_grade null, no override given)', async () => {
      classRepo.findOne.mockResolvedValue({
        id: 'class-1',
        numeric_grade: null,
        shift_id: null,
        version: null,
        academic_year_id: 'year-1',
      });

      await expect(
        service.create(
          {
            source_class_id: 'class-1',
            target_academic_year_id: 'year-2',
            exam_ids: ['exam-1'],
            algorithm: PlacementAlgorithm.BLOCK,
          },
          TENANT_ID,
          'user-1',
        ),
      ).rejects.toThrow(UnprocessableEntityException);
    });
  });

  describe('patchEntries', () => {
    it('throws ConflictException when the run is not DRAFT', async () => {
      const manager = {
        getRepository: (entity: unknown) => {
          if ((entity as { name?: string })?.name === 'PromotionEntry') return entryRepo;
          return {
            ...runRepo,
            findOne: vi.fn().mockResolvedValue({
              id: 'run-1',
              status: PromotionRunStatus.COMMITTED,
              tenant_id: TENANT_ID,
            }),
          };
        },
      };
      runRepo.manager.transaction.mockImplementation(async (cb: (m: unknown) => unknown) => cb(manager));

      await expect(
        service.patchEntries('run-1', [{ student_id: 's1', final_outcome: PromotionOutcome.RETAIN }], TENANT_ID, 'user-1'),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('remove', () => {
    it('throws NotFoundException when the run does not exist', async () => {
      runRepo.findOne.mockResolvedValue(null);
      await expect(service.remove('run-1', TENANT_ID)).rejects.toThrow(NotFoundException);
    });

    it('throws ConflictException when the run is COMMITTED', async () => {
      runRepo.findOne.mockResolvedValue({ id: 'run-1', status: PromotionRunStatus.COMMITTED });
      await expect(service.remove('run-1', TENANT_ID)).rejects.toThrow(ConflictException);
    });

    it('deletes a DRAFT run', async () => {
      runRepo.findOne.mockResolvedValue({ id: 'run-1', status: PromotionRunStatus.DRAFT });
      await service.remove('run-1', TENANT_ID);
      expect(runRepo.delete).toHaveBeenCalledWith({ id: 'run-1', tenant_id: TENANT_ID });
    });
  });

  describe('findOne', () => {
    it('throws NotFoundException for a run in another tenant', async () => {
      runRepo.findOne.mockResolvedValue(null);
      await expect(service.findOne('run-1', TENANT_ID)).rejects.toThrow(NotFoundException);
    });
  });
});
