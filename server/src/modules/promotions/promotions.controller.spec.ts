import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PromotionsController } from './promotions.controller';
import { PlacementAlgorithm } from '@biddaloy/shared';

describe('PromotionsController (unit)', () => {
  let controller: PromotionsController;
  let service: {
    suggestTarget: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    patchEntries: ReturnType<typeof vi.fn>;
    refresh: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
    list: ReturnType<typeof vi.fn>;
    findOne: ReturnType<typeof vi.fn>;
    commit: ReturnType<typeof vi.fn>;
    findStudentOverrides: ReturnType<typeof vi.fn>;
  };
  let familyAccess: { assertLinked: ReturnType<typeof vi.fn> };

  const tenant = { id: 'tenant-1', role: 'ADMIN' };
  const user = { sub: 'user-1', email: null, phone: null, memberships: [], jti: 'jti-1' } as any;

  beforeEach(() => {
    familyAccess = { assertLinked: vi.fn().mockResolvedValue(undefined) };
    service = {
      suggestTarget: vi.fn().mockResolvedValue({ target_class: null }),
      create: vi.fn().mockResolvedValue({ id: 'run-1' }),
      patchEntries: vi.fn().mockResolvedValue({ id: 'run-1' }),
      refresh: vi.fn().mockResolvedValue({ id: 'run-1' }),
      remove: vi.fn().mockResolvedValue(undefined),
      list: vi.fn().mockResolvedValue([]),
      findOne: vi.fn().mockResolvedValue({ id: 'run-1' }),
      commit: vi.fn().mockResolvedValue({ id: 'run-1' }),
      findStudentOverrides: vi.fn().mockResolvedValue([]),
    };
    controller = new PromotionsController(service as any, familyAccess as any);
  });

  it('suggestTarget forwards the query and tenant', async () => {
    await controller.suggestTarget({ source_class_id: 'c1', target_academic_year_id: 'y2' }, tenant);
    expect(service.suggestTarget).toHaveBeenCalledWith('c1', 'y2', tenant.id);
  });

  it('create forwards dto, tenant id, and user id', async () => {
    const dto = {
      source_class_id: 'c1',
      target_academic_year_id: 'y2',
      exam_ids: ['e1'],
      algorithm: PlacementAlgorithm.BLOCK,
    };
    await controller.create(dto, tenant, user);
    expect(service.create).toHaveBeenCalledWith(dto, tenant.id, user.sub);
  });

  it('patchEntries forwards the run id, entries array, tenant, and user', async () => {
    const entries = [{ student_id: 's1', final_outcome: 'RETAIN' }] as any;
    await controller.patchEntries('run-1', entries, tenant, user);
    expect(service.patchEntries).toHaveBeenCalledWith('run-1', entries, tenant.id, user.sub);
  });

  it('remove forwards run id and tenant', async () => {
    await controller.remove('run-1', tenant);
    expect(service.remove).toHaveBeenCalledWith('run-1', tenant.id);
  });

  it('list forwards tenant and optional source_class_id filter', async () => {
    await controller.list({ source_class_id: 'c1' }, tenant);
    expect(service.list).toHaveBeenCalledWith(tenant.id, 'c1');
  });

  it('findOne forwards run id and tenant', async () => {
    await controller.findOne('run-1', tenant);
    expect(service.findOne).toHaveBeenCalledWith('run-1', tenant.id);
  });

  it('findStudentOverrides checks family access then forwards student id and tenant', async () => {
    await controller.findStudentOverrides('student-1', tenant, user);
    expect(familyAccess.assertLinked).toHaveBeenCalledWith(tenant.role, user.sub, 'student-1', tenant.id);
    expect(service.findStudentOverrides).toHaveBeenCalledWith('student-1', tenant.id);
  });

  it('commit calls service.commit then re-fetches the run via findOne', async () => {
    const request = { headers: {} } as any;
    await controller.commit('run-1', tenant, user, request);
    expect(service.commit).toHaveBeenCalledWith('run-1', tenant.id, user.sub, tenant.role, request, {
      ip: null,
      userAgent: null,
    });
    expect(service.findOne).toHaveBeenCalledWith('run-1', tenant.id);
  });
});
