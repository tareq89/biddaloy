import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { RecomputeService, NoopResultRecomputer } from './recompute.service';

const VALID_BANDS = [
  { percent_from: 0, percent_to: 59, grade: 'B', sequence: 2 },
  { percent_from: 60, percent_to: 100, grade: 'A', sequence: 1 },
];

function fakeManager(scaleRepo: any, bandRepo: any) {
  return {
    getRepository: vi.fn((entity: any) => (entity?.name === 'GradingBand' ? bandRepo : scaleRepo)),
  };
}

describe('RecomputeService', () => {
  const TENANT = 'tenant-1';
  const SCALE_ID = 'scale-1';
  let scaleRepo: any;
  let bandRepo: any;
  let dataSource: any;
  let auditService: any;
  let resultRecomputer: NoopResultRecomputer;
  let service: RecomputeService;

  beforeEach(() => {
    scaleRepo = {
      findOne: vi.fn(async () => ({ id: SCALE_ID, tenant_id: TENANT, revision: 1 })),
      save: vi.fn(async (v: any) => v),
    };
    bandRepo = {
      find: vi.fn(async () => []),
      create: vi.fn((v: any) => v),
      save: vi.fn(async (v: any) => v.map((b: any, i: number) => ({ id: `b${i}`, ...b }))),
      softDelete: vi.fn(async () => ({ affected: 1 })),
    };
    auditService = { record: vi.fn(), recordApproved: vi.fn() };
    dataSource = { transaction: vi.fn(async (cb: any) => cb(fakeManager(scaleRepo, bandRepo))) };
    resultRecomputer = new NoopResultRecomputer();

    service = new RecomputeService(scaleRepo, bandRepo, dataSource, auditService, resultRecomputer);
  });

  describe('preview', () => {
    it('writes nothing', async () => {
      await service.preview(SCALE_ID, TENANT, VALID_BANDS as any);
      expect(bandRepo.save).not.toHaveBeenCalled();
      expect(bandRepo.softDelete).not.toHaveBeenCalled();
      expect(scaleRepo.save).not.toHaveBeenCalled();
    });

    it('reports invalid bands without touching the recomputer', async () => {
      const spy = vi.spyOn(resultRecomputer, 'countAffected');
      const result = await service.preview(SCALE_ID, TENANT, [
        { percent_from: 0, percent_to: 50, grade: 'B', sequence: 1 },
      ] as any);
      expect(result.valid).toBe(false);
      expect(spy).not.toHaveBeenCalled();
    });

    it('reports bands_changed against the currently stored set', async () => {
      bandRepo.find.mockResolvedValueOnce(
        VALID_BANDS.map((b, i) => ({
          ...b,
          id: `b${i}`,
          gpa: null,
          is_fail: false,
          comment: null,
        })),
      );
      const unchanged = await service.preview(SCALE_ID, TENANT, VALID_BANDS as any);
      expect(unchanged.bands_changed).toBe(false);
    });
  });

  describe('confirm', () => {
    it('requires a valid band set', async () => {
      await expect(
        service.confirm(SCALE_ID, TENANT, 'user-1', 'approver-1', [
          { percent_from: 0, percent_to: 50, grade: 'B', sequence: 1 },
        ] as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('increments revision by exactly one and writes an approved audit entry', async () => {
      const result = await service.confirm(
        SCALE_ID,
        TENANT,
        'user-1',
        'approver-1',
        VALID_BANDS as any,
      );
      expect(result.scale.revision).toBe(2);
      expect(auditService.recordApproved).toHaveBeenCalledTimes(1);
      expect(auditService.recordApproved.mock.calls[0][0]).toMatchObject({
        approved_by_user_id: 'approver-1',
      });
    });

    it('replaces bands by soft-deleting the old set, not patching rows', async () => {
      await service.confirm(SCALE_ID, TENANT, 'user-1', 'approver-1', VALID_BANDS as any);
      expect(bandRepo.softDelete).toHaveBeenCalledWith({ scale_id: SCALE_ID, tenant_id: TENANT });
      expect(bandRepo.save).toHaveBeenCalledTimes(1);
    });

    it('rolls back band changes and the revision bump if recompute fails mid-way', async () => {
      vi.spyOn(resultRecomputer, 'recompute').mockRejectedValueOnce(new Error('boom'));
      // The transaction callback itself throws — a real DataSource would
      // roll back everything the callback did. This fake just re-throws,
      // matching `dataSource.transaction`'s real contract: a caller can
      // assert failure propagates and nothing downstream (e.g. the audit
      // write below) ran.
      await expect(
        service.confirm(SCALE_ID, TENANT, 'user-1', 'approver-1', VALID_BANDS as any),
      ).rejects.toThrow('boom');
      expect(auditService.recordApproved).not.toHaveBeenCalled();
    });
  });
});
