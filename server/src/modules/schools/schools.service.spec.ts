import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { SchoolsService } from './schools.service';
import { TenantSettingsDto } from './dto/tenant-settings.dto';
import { DEFAULT_REGION_SETTINGS } from './settings/tenant-settings-defaults';

function fakeRepo() {
  return {
    findOne: vi.fn(),
    save: vi.fn(),
  };
}

describe('SchoolsService', () => {
  let repo: ReturnType<typeof fakeRepo>;
  let service: SchoolsService;

  beforeEach(() => {
    repo = fakeRepo();
    service = new SchoolsService(repo as any);
  });

  describe('findById', () => {
    it('returns the school when found', async () => {
      const school = { id: 's1', settings: null };
      repo.findOne.mockResolvedValue(school);

      expect(await service.findById('s1')).toBe(school);
      expect(repo.findOne).toHaveBeenCalledWith({ where: { id: 's1' } });
    });

    it('throws NotFoundException when the school does not exist', async () => {
      repo.findOne.mockResolvedValue(null);

      await expect(service.findById('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('getResolvedSettings', () => {
    it('resolves defaults for a school with no stored settings', async () => {
      repo.findOne.mockResolvedValue({ id: 's1', settings: null });

      const resolved = await service.getResolvedSettings('s1');

      expect(resolved.version).toBe(1);
      expect(resolved.region).toEqual(DEFAULT_REGION_SETTINGS);
    });
  });

  describe('updateSettings', () => {
    it('merges the patch into the stored settings and persists it', async () => {
      const school = {
        id: 's1',
        settings: { version: 1, communications: { sms: { provider: 'greenweb' } } },
      };
      repo.findOne.mockResolvedValue(school);
      repo.save.mockImplementation(async (s: typeof school) => s);

      const patch = plainToInstance(TenantSettingsDto, {
        version: 1,
        communications: { whatsapp: { phoneNumberId: '1', accessToken: 'tok' } },
      });

      const resolved = await service.updateSettings('s1', patch);

      expect(repo.save).toHaveBeenCalledTimes(1);
      const saved = repo.save.mock.calls[0][0];
      expect(saved.settings.communications.sms).toEqual({ provider: 'greenweb' });
      expect(saved.settings.communications.whatsapp).toEqual({
        phoneNumberId: '1',
        accessToken: 'tok',
      });
      expect(resolved.region).toEqual(DEFAULT_REGION_SETTINGS);
    });

    it('throws NotFoundException for an unknown school rather than writing anything', async () => {
      repo.findOne.mockResolvedValue(null);
      const patch = plainToInstance(TenantSettingsDto, { version: 1 });

      await expect(service.updateSettings('missing', patch)).rejects.toThrow(NotFoundException);
      expect(repo.save).not.toHaveBeenCalled();
    });
  });
});
