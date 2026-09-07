import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { AuditAction } from '@biddaloy/shared';
import { SchoolProfileService } from './profile.service';
import { UpdateSchoolProfileDto } from './dto/update-school-profile.dto';

const REQUEST_CONTEXT = { ip: '10.0.0.1', userAgent: 'vitest' };

/** Same transactional-EntityManager shape as `schools.service.spec.ts`'s
 * own `fakeRepo` — `updateProfile` reads/writes the school and writes its
 * audit entry inside one `repo.manager.transaction`. */
function fakeRepo(school: Record<string, unknown> | null) {
  const schoolRepo = {
    createQueryBuilder: vi.fn(() => ({
      where: vi.fn().mockReturnThis(),
      setLock: vi.fn().mockReturnThis(),
      getOne: vi.fn(async () => school),
    })),
    save: vi.fn(async (s: typeof school) => s),
  };
  const manager = { getRepository: vi.fn(() => schoolRepo) };
  return {
    findOne: vi.fn(async () => school),
    manager: { transaction: vi.fn(async (cb: any) => cb(manager)) },
    schoolRepo,
  };
}

function fakeAuditService() {
  return { record: vi.fn() };
}

function baseSchool() {
  return {
    id: 'school-1',
    name: 'Old Name',
    name_bn: null,
    address: null,
    phone: null,
    email: null,
    registration_id: null,
    logo_key: null,
  };
}

describe('SchoolProfileService', () => {
  let auditService: ReturnType<typeof fakeAuditService>;

  beforeEach(() => {
    auditService = fakeAuditService();
  });

  describe('getProfile', () => {
    it('returns the six text fields plus a null logo_url when unset', async () => {
      const repo = fakeRepo(baseSchool());
      const service = new SchoolProfileService(repo as any, auditService as any);

      const result = await service.getProfile('school-1');

      expect(result).toEqual({
        name: 'Old Name',
        name_bn: null,
        address: null,
        phone: null,
        email: null,
        registration_id: null,
        logo_url: null,
      });
    });

    it('builds a versioned logo_url from logo_key when set', async () => {
      const school = { ...baseSchool(), logo_key: 'tenants/school-1/logo/abc-123.png' };
      const repo = fakeRepo(school);
      const service = new SchoolProfileService(repo as any, auditService as any);

      const result = await service.getProfile('school-1');

      expect(result.logo_url).toBe('/schools/school-1/logo?v=abc-123');
    });

    it('throws NotFoundException for a missing school', async () => {
      const repo = fakeRepo(null);
      const service = new SchoolProfileService(repo as any, auditService as any);

      await expect(service.getProfile('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateProfile', () => {
    it('writes only the changed fields and audits old/new values', async () => {
      const repo = fakeRepo(baseSchool());
      const service = new SchoolProfileService(repo as any, auditService as any);

      const dto = new UpdateSchoolProfileDto();
      dto.name = 'New Name';
      dto.registration_id = 'EIIN-1';

      const result = await service.updateProfile('school-1', dto, 'user-1', REQUEST_CONTEXT);

      expect(result.name).toBe('New Name');
      expect(result.registration_id).toBe('EIIN-1');
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.UPDATE,
          entity_type: 'School',
          entity_id: 'school-1',
          tenant_id: 'school-1',
          performed_by_user_id: 'user-1',
          old_values: { name: 'Old Name', registration_id: null },
          new_values: { name: 'New Name', registration_id: 'EIIN-1' },
        }),
        expect.anything(),
      );
    });

    it('skips the audit write when nothing actually changed', async () => {
      const repo = fakeRepo(baseSchool());
      const service = new SchoolProfileService(repo as any, auditService as any);

      const dto = new UpdateSchoolProfileDto();
      dto.name = 'Old Name'; // same as current

      await service.updateProfile('school-1', dto, 'user-1', REQUEST_CONTEXT);

      expect(auditService.record).not.toHaveBeenCalled();
    });

    it('throws NotFoundException for a missing school', async () => {
      const repo = fakeRepo(null);
      const service = new SchoolProfileService(repo as any, auditService as any);

      await expect(
        service.updateProfile('missing', new UpdateSchoolProfileDto(), 'user-1', REQUEST_CONTEXT),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
