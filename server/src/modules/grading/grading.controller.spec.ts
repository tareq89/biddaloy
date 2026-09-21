import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InternalServerErrorException } from '@nestjs/common';
import { GradingController } from './grading.controller';

const TENANT = { id: 'tenant-1', role: 'ADMIN' };
const USER = { sub: 'user-1' } as any;

describe('GradingController', () => {
  let gradingService: any;
  let recomputeService: any;
  let controller: GradingController;

  beforeEach(() => {
    gradingService = {
      create: vi.fn(async () => ({ id: 'scale-1', name: 'Default' })),
      findAll: vi.fn(async () => []),
      findOne: vi.fn(async () => ({ id: 'scale-1' })),
      findBands: vi.fn(async () => []),
      update: vi.fn(async () => ({ id: 'scale-1' })),
      remove: vi.fn(async () => undefined),
      copy: vi.fn(async () => []),
    };
    recomputeService = {
      preview: vi.fn(async () => ({
        valid: true,
        problems: [],
        bands_changed: true,
        affected_result_count: 0,
      })),
      confirm: vi.fn(async () => ({
        scale: { id: 'scale-1', revision: 2 },
        bands: [],
        affected_result_count: 0,
      })),
    };
    controller = new GradingController(gradingService, recomputeService);
  });

  it('create() delegates to GradingService and shapes the response', async () => {
    const result = await controller.create(
      { academic_year_id: 'year-1', name: 'Default' } as any,
      TENANT,
      USER,
    );
    expect(result.id).toBe('scale-1');
    expect(gradingService.create).toHaveBeenCalledWith(TENANT.id, USER.sub, expect.any(Object));
  });

  it('confirmBands() throws when ApprovalGuard did not stamp request.approval', async () => {
    const request = {} as any;
    await expect(
      controller.confirmBands('scale-1', { bands: [] } as any, TENANT, USER, request),
    ).rejects.toThrow(InternalServerErrorException);
    expect(recomputeService.confirm).not.toHaveBeenCalled();
  });

  it('confirmBands() passes the approver id from the stamped approval context', async () => {
    const request = { approval: { approverId: 'approver-1' } } as any;
    await controller.confirmBands('scale-1', { bands: [] } as any, TENANT, USER, request);
    expect(recomputeService.confirm).toHaveBeenCalledWith(
      'scale-1',
      TENANT.id,
      USER.sub,
      'approver-1',
      [],
    );
  });

  it('previewBands() writes nothing and returns the preview result', async () => {
    const result = await controller.previewBands('scale-1', { bands: [] } as any, TENANT);
    expect(result.valid).toBe(true);
    expect(recomputeService.confirm).not.toHaveBeenCalled();
  });

  it('copy() delegates target/source ids correctly', async () => {
    await controller.copy('target-id', { source_scale_id: 'source-id' } as any, TENANT, USER);
    expect(gradingService.copy).toHaveBeenCalledWith('source-id', 'target-id', TENANT.id, USER.sub);
  });
});
