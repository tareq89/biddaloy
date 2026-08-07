import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { randomBytes } from 'crypto';
import { AuditAction } from '@beton-boi/shared';
import { SchoolsService } from './schools.service';
import { TenantSettingsDto } from './dto/tenant-settings.dto';
import { DEFAULT_REGION_SETTINGS } from './settings/tenant-settings-defaults';
import { EncryptionService } from './settings/encryption.service';
import { TenantSettingsCache } from './settings/tenant-settings-cache.service';

const REQUEST_CONTEXT = { ip: '10.0.0.1', userAgent: 'vitest' };

/**
 * `updateSettings` reads/writes the school and writes its audit entry
 * inside one `repo.manager.transaction` (#8.7.11) — this stands in for the
 * transactional `EntityManager` the callback receives, same shape as
 * `fees.service.ts`'s own transactional tests.
 */
function fakeRepo(school: { id: string; settings: unknown } | null) {
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

describe('SchoolsService', () => {
  let encryption: EncryptionService;
  let settingsCache: TenantSettingsCache;
  let auditService: ReturnType<typeof fakeAuditService>;

  beforeEach(() => {
    encryption = new EncryptionService(randomBytes(32));
    settingsCache = new TenantSettingsCache(30_000);
    auditService = fakeAuditService();
  });

  describe('findById', () => {
    it('returns the school when found', async () => {
      const school = { id: 's1', settings: null };
      const repo = fakeRepo(school);
      const service = new SchoolsService(
        repo as any,
        encryption,
        settingsCache,
        auditService as any,
      );

      expect(await service.findById('s1')).toBe(school);
      expect(repo.findOne).toHaveBeenCalledWith({ where: { id: 's1' } });
    });

    it('throws NotFoundException when the school does not exist', async () => {
      const repo = fakeRepo(null);
      const service = new SchoolsService(
        repo as any,
        encryption,
        settingsCache,
        auditService as any,
      );

      await expect(service.findById('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('getResolvedSettings', () => {
    it('resolves defaults for a school with no stored settings', async () => {
      const repo = fakeRepo({ id: 's1', settings: null });
      const service = new SchoolsService(
        repo as any,
        encryption,
        settingsCache,
        auditService as any,
      );

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
      const repo = fakeRepo(school);
      const service = new SchoolsService(
        repo as any,
        encryption,
        settingsCache,
        auditService as any,
      );

      const patch = plainToInstance(TenantSettingsDto, {
        version: 1,
        communications: { whatsapp: { phoneNumberId: '1', accessToken: 'tok' } },
      });

      const resolved = await service.updateSettings('s1', patch, 'user-1', REQUEST_CONTEXT);

      expect(repo.schoolRepo.save).toHaveBeenCalledTimes(1);
      const saved = repo.schoolRepo.save.mock.calls[0][0];
      expect(saved.settings.communications.sms).toEqual({ provider: 'greenweb' });
      expect(saved.settings.communications.whatsapp.phoneNumberId).toBe('1');
      expect(resolved.region).toEqual(DEFAULT_REGION_SETTINGS);
    });

    it('invalidates the settings cache for this school after saving', async () => {
      const repo = fakeRepo({ id: 's1', settings: null });
      const service = new SchoolsService(
        repo as any,
        encryption,
        settingsCache,
        auditService as any,
      );
      const invalidateSpy = vi.spyOn(settingsCache, 'invalidate');

      const patch = plainToInstance(TenantSettingsDto, { version: 1 });
      await service.updateSettings('s1', patch, 'user-1', REQUEST_CONTEXT);

      expect(invalidateSpy).toHaveBeenCalledWith('s1');
      expect(invalidateSpy).toHaveBeenCalledTimes(1);
    });

    it('encrypts secret fields before persisting rather than storing them as plaintext', async () => {
      const repo = fakeRepo({ id: 's1', settings: null });
      const service = new SchoolsService(
        repo as any,
        encryption,
        settingsCache,
        auditService as any,
      );

      const patch = plainToInstance(TenantSettingsDto, {
        version: 1,
        communications: { whatsapp: { phoneNumberId: '1', accessToken: 'super-secret-token' } },
      });

      await service.updateSettings('s1', patch, 'user-1', REQUEST_CONTEXT);

      const savedToken =
        repo.schoolRepo.save.mock.calls[0][0].settings.communications.whatsapp.accessToken;
      expect(savedToken).not.toBe('super-secret-token');
      expect(savedToken).toMatch(/^gcmv1:/);
      expect(encryption.decrypt(savedToken)).toBe('super-secret-token');
    });

    it('throws NotFoundException for an unknown school rather than writing anything', async () => {
      const repo = fakeRepo(null);
      const service = new SchoolsService(
        repo as any,
        encryption,
        settingsCache,
        auditService as any,
      );
      const patch = plainToInstance(TenantSettingsDto, { version: 1 });

      await expect(
        service.updateSettings('missing', patch, 'user-1', REQUEST_CONTEXT),
      ).rejects.toThrow(NotFoundException);
      expect(repo.schoolRepo.save).not.toHaveBeenCalled();
      expect(auditService.record).not.toHaveBeenCalled();
    });

    it('writes a SETTINGS_CHANGE audit entry, in the same transaction, with actor/tenant/timestamp context', async () => {
      const school = { id: 's1', settings: { version: 1 } };
      const repo = fakeRepo(school);
      const service = new SchoolsService(
        repo as any,
        encryption,
        settingsCache,
        auditService as any,
      );

      const patch = plainToInstance(TenantSettingsDto, {
        version: 1,
        communications: { whatsapp: { phoneNumberId: '1', accessToken: 'tok' } },
      });

      await service.updateSettings('s1', patch, 'user-1', REQUEST_CONTEXT);

      expect(auditService.record).toHaveBeenCalledTimes(1);
      const [entry, manager] = auditService.record.mock.calls[0];
      expect(entry).toMatchObject({
        action: AuditAction.SETTINGS_CHANGE,
        entity_type: 'School',
        entity_id: 's1',
        tenant_id: 's1',
        performed_by_user_id: 'user-1',
        ip_address: '10.0.0.1',
        user_agent: 'vitest',
      });
      // The transactional manager, not the top-level repo — so a failed
      // audit write rolls back the settings save with it.
      expect(manager).toBeDefined();
    });

    it('never writes the plaintext or encrypted secret value into the audit diff', async () => {
      const school = {
        id: 's1',
        settings: {
          communications: { whatsapp: { accessToken: encryption.encrypt('old-token') } },
        },
      };
      const repo = fakeRepo(school);
      const service = new SchoolsService(
        repo as any,
        encryption,
        settingsCache,
        auditService as any,
      );

      const patch = plainToInstance(TenantSettingsDto, {
        version: 1,
        communications: { whatsapp: { phoneNumberId: '1', accessToken: 'new-plaintext-token' } },
      });

      await service.updateSettings('s1', patch, 'user-1', REQUEST_CONTEXT);

      const [entry] = auditService.record.mock.calls[0];
      const serialized = JSON.stringify(entry);
      expect(serialized).not.toContain('new-plaintext-token');
      expect(serialized).not.toContain('old-token');
      expect((entry.new_values as any).communications.whatsapp.accessToken).toBe('[REDACTED]');
      expect((entry.old_values as any).communications.whatsapp.accessToken).toBe('[REDACTED]');
    });

    it('scopes the audit diff to only the fields the patch touches', async () => {
      const school = {
        id: 's1',
        settings: {
          version: 1,
          communications: { sms: { provider: 'greenweb' }, whatsapp: { phoneNumberId: 'old-id' } },
        },
      };
      const repo = fakeRepo(school);
      const service = new SchoolsService(
        repo as any,
        encryption,
        settingsCache,
        auditService as any,
      );

      const patch = plainToInstance(TenantSettingsDto, {
        version: 1,
        communications: { whatsapp: { phoneNumberId: 'new-id' } },
      });

      await service.updateSettings('s1', patch, 'user-1', REQUEST_CONTEXT);

      const [entry] = auditService.record.mock.calls[0];
      expect(entry.old_values).toEqual({
        version: 1,
        communications: { whatsapp: { phoneNumberId: 'old-id' } },
      });
      expect(entry.new_values).toMatchObject({
        version: 1,
        communications: { whatsapp: { phoneNumberId: 'new-id' } },
      });
      expect(entry.old_values).not.toHaveProperty('communications.sms');
    });
  });

  describe('getDecryptedSettings', () => {
    it('returns the plaintext secret rather than the stored envelope', async () => {
      const envelope = encryption.encrypt('super-secret-token');
      const repo = fakeRepo({
        id: 's1',
        settings: {
          version: 1,
          communications: { whatsapp: { phoneNumberId: '1', accessToken: envelope } },
        },
      });
      const service = new SchoolsService(
        repo as any,
        encryption,
        settingsCache,
        auditService as any,
      );

      const decrypted = await service.getDecryptedSettings('s1');

      expect(decrypted.communications?.whatsapp?.accessToken).toBe('super-secret-token');
    });

    it('leaves an unconfigured medium as undefined rather than throwing', async () => {
      const repo = fakeRepo({ id: 's1', settings: null });
      const service = new SchoolsService(
        repo as any,
        encryption,
        settingsCache,
        auditService as any,
      );

      const decrypted = await service.getDecryptedSettings('s1');

      expect(decrypted.communications).toBeUndefined();
    });
  });

  describe('getMaskedSettings', () => {
    it('returns a masked hint instead of the plaintext or the raw envelope', async () => {
      const envelope = encryption.encrypt('super-secret-token');
      const repo = fakeRepo({
        id: 's1',
        settings: {
          version: 1,
          communications: { whatsapp: { phoneNumberId: '1', accessToken: envelope } },
        },
      });
      const service = new SchoolsService(
        repo as any,
        encryption,
        settingsCache,
        auditService as any,
      );

      const masked = await service.getMaskedSettings('s1');
      const whatsapp = (masked.communications as any).whatsapp;

      expect(whatsapp.accessToken).toEqual({ configured: true, hint: '••••oken' });
      expect(JSON.stringify(masked)).not.toContain('super-secret-token');
      expect(JSON.stringify(masked)).not.toContain(envelope);
    });

    it('resolves defaults for a school with no stored settings, same as getResolvedSettings', async () => {
      const repo = fakeRepo({ id: 's1', settings: null });
      const service = new SchoolsService(
        repo as any,
        encryption,
        settingsCache,
        auditService as any,
      );

      const masked = await service.getMaskedSettings('s1');

      expect(masked.version).toBe(1);
      expect(masked.region).toEqual(DEFAULT_REGION_SETTINGS);
    });
  });
});
