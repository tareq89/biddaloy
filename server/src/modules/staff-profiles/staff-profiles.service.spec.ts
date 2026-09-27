import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { StaffProfilesService } from './staff-profiles.service';

const TENANT = 'tenant-1';

describe('StaffProfilesService', () => {
  let repo: any;
  let service: StaffProfilesService;

  beforeEach(() => {
    repo = {
      findOne: vi.fn(async () => null),
      count: vi.fn(async () => 0),
      create: vi.fn((v: any) => v),
      save: vi.fn(async (v: any) => ({ id: 'profile-1', ...v })),
    };
    service = new StaffProfilesService(repo);
  });

  describe('createFor', () => {
    it('generates a sequential EMP-<tenant_short>-<sequence> employee_id when none is given', async () => {
      repo.count = vi.fn(async () => 2); // two profiles already exist for this tenant
      const profile = await service.createFor('user-1', TENANT);
      expect(profile.employee_id).toBe(`EMP-${TENANT.slice(0, 8)}-3`);
      expect(profile.user_id).toBe('user-1');
      expect(profile.tenant_id).toBe(TENANT);
    });

    it('uses the given employee_id when provided', async () => {
      const profile = await service.createFor('user-1', TENANT, { employeeId: 'EMP-CUSTOM-1' });
      expect(profile.employee_id).toBe('EMP-CUSTOM-1');
    });

    it('throws ConflictException when the given employee_id already exists in the tenant', async () => {
      repo.findOne = vi.fn(async ({ where }: any) =>
        where.employee_id ? { id: 'existing', ...where } : null,
      );
      await expect(
        service.createFor('user-1', TENANT, { employeeId: 'EMP-DUP-1' }),
      ).rejects.toThrow(ConflictException);
    });

    it('throws ConflictException when the user already has a staff profile', async () => {
      repo.findOne = vi.fn(async ({ where }: any) =>
        where.user_id ? { id: 'existing', user_id: where.user_id } : null,
      );
      await expect(service.createFor('user-1', TENANT)).rejects.toThrow(ConflictException);
    });

    it('runs against the given transaction manager instead of the injected repo', async () => {
      const txRepo = {
        findOne: vi.fn(async () => null),
        count: vi.fn(async () => 0),
        create: vi.fn((v: any) => v),
        save: vi.fn(async (v: any) => ({ id: 'profile-2', ...v })),
      };
      const manager = { getRepository: vi.fn(() => txRepo) } as any;

      await service.createFor('user-2', TENANT, undefined, manager);

      expect(manager.getRepository).toHaveBeenCalled();
      expect(txRepo.save).toHaveBeenCalled();
      expect(repo.save).not.toHaveBeenCalled();
    });
  });
});
