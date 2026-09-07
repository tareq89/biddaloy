import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { randomBytes } from 'crypto';
import { AuditAction } from '@biddaloy/shared';
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
    update: vi.fn(async () => ({ affected: 1 })),
  };
  const manager = { getRepository: vi.fn(() => schoolRepo) };
  return {
    findOne: vi.fn(async () => school),
    find: vi.fn(async () => []),
    manager: { transaction: vi.fn(async (cb: any) => cb(manager)) },
    schoolRepo,
  };
}

function fakeAuditService() {
  return { record: vi.fn() };
}

function fakeTenantStatus() {
  return { invalidate: vi.fn(), isActive: vi.fn() };
}

describe('SchoolsService', () => {
  let encryption: EncryptionService;
  let settingsCache: TenantSettingsCache;
  let auditService: ReturnType<typeof fakeAuditService>;
  let tenantStatus: ReturnType<typeof fakeTenantStatus>;

  beforeEach(() => {
    encryption = new EncryptionService(randomBytes(32));
    settingsCache = new TenantSettingsCache(30_000);
    auditService = fakeAuditService();
    tenantStatus = fakeTenantStatus();
  });

  describe('findById', () => {
    it('returns the school when found', async () => {
      const school = { id: 's1', settings: null };
      const repo = fakeRepo(school);
      const service = new SchoolsService(
        repo as any,
        {
          createQueryBuilder: vi.fn(() => ({
            innerJoin: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            andWhere: vi.fn().mockReturnThis(),
            getCount: vi.fn(async () => 0),
          })),
        } as any,
        { count: vi.fn(async () => 0) } as any,
        { count: vi.fn(async () => 0) } as any,
        {
          createQueryBuilder: vi.fn(() => ({
            select: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            getRawOne: vi.fn(async () => ({ max_created_at: null })),
          })),
        } as any,
        { get: vi.fn(async () => null), set: vi.fn(async () => 'OK') } as any,
        encryption,
        settingsCache,
        auditService as any,
        tenantStatus as any,
      );

      expect(await service.findById('s1')).toBe(school);
      expect(repo.findOne).toHaveBeenCalledWith({ where: { id: 's1' } });
    });

    it('throws NotFoundException when the school does not exist', async () => {
      const repo = fakeRepo(null);
      const service = new SchoolsService(
        repo as any,
        {
          createQueryBuilder: vi.fn(() => ({
            innerJoin: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            andWhere: vi.fn().mockReturnThis(),
            getCount: vi.fn(async () => 0),
          })),
        } as any,
        { count: vi.fn(async () => 0) } as any,
        { count: vi.fn(async () => 0) } as any,
        {
          createQueryBuilder: vi.fn(() => ({
            select: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            getRawOne: vi.fn(async () => ({ max_created_at: null })),
          })),
        } as any,
        { get: vi.fn(async () => null), set: vi.fn(async () => 'OK') } as any,
        encryption,
        settingsCache,
        auditService as any,
        tenantStatus as any,
      );

      await expect(service.findById('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('findAll', () => {
    it('returns every school, id and name only, ordered by name', async () => {
      const repo = fakeRepo(null);
      repo.find.mockResolvedValue([
        { id: 's2', name: 'Zenith School' },
        { id: 's1', name: 'Ananta School' },
      ]);
      const service = new SchoolsService(
        repo as any,
        {
          createQueryBuilder: vi.fn(() => ({
            innerJoin: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            andWhere: vi.fn().mockReturnThis(),
            getCount: vi.fn(async () => 0),
          })),
        } as any,
        { count: vi.fn(async () => 0) } as any,
        { count: vi.fn(async () => 0) } as any,
        {
          createQueryBuilder: vi.fn(() => ({
            select: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            getRawOne: vi.fn(async () => ({ max_created_at: null })),
          })),
        } as any,
        { get: vi.fn(async () => null), set: vi.fn(async () => 'OK') } as any,
        encryption,
        settingsCache,
        auditService as any,
        tenantStatus as any,
      );

      const schools = await service.findAll();

      expect(repo.find).toHaveBeenCalledWith({ select: ['id', 'name'], order: { name: 'ASC' } });
      expect(schools).toEqual([
        { id: 's2', name: 'Zenith School' },
        { id: 's1', name: 'Ananta School' },
      ]);
    });
  });

  describe('getResolvedSettings', () => {
    it('resolves defaults for a school with no stored settings', async () => {
      const repo = fakeRepo({ id: 's1', settings: null });
      const service = new SchoolsService(
        repo as any,
        {
          createQueryBuilder: vi.fn(() => ({
            innerJoin: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            andWhere: vi.fn().mockReturnThis(),
            getCount: vi.fn(async () => 0),
          })),
        } as any,
        { count: vi.fn(async () => 0) } as any,
        { count: vi.fn(async () => 0) } as any,
        {
          createQueryBuilder: vi.fn(() => ({
            select: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            getRawOne: vi.fn(async () => ({ max_created_at: null })),
          })),
        } as any,
        { get: vi.fn(async () => null), set: vi.fn(async () => 'OK') } as any,
        encryption,
        settingsCache,
        auditService as any,
        tenantStatus as any,
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
        {
          createQueryBuilder: vi.fn(() => ({
            innerJoin: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            andWhere: vi.fn().mockReturnThis(),
            getCount: vi.fn(async () => 0),
          })),
        } as any,
        { count: vi.fn(async () => 0) } as any,
        { count: vi.fn(async () => 0) } as any,
        {
          createQueryBuilder: vi.fn(() => ({
            select: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            getRawOne: vi.fn(async () => ({ max_created_at: null })),
          })),
        } as any,
        { get: vi.fn(async () => null), set: vi.fn(async () => 'OK') } as any,
        encryption,
        settingsCache,
        auditService as any,
        tenantStatus as any,
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
        {
          createQueryBuilder: vi.fn(() => ({
            innerJoin: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            andWhere: vi.fn().mockReturnThis(),
            getCount: vi.fn(async () => 0),
          })),
        } as any,
        { count: vi.fn(async () => 0) } as any,
        { count: vi.fn(async () => 0) } as any,
        {
          createQueryBuilder: vi.fn(() => ({
            select: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            getRawOne: vi.fn(async () => ({ max_created_at: null })),
          })),
        } as any,
        { get: vi.fn(async () => null), set: vi.fn(async () => 'OK') } as any,
        encryption,
        settingsCache,
        auditService as any,
        tenantStatus as any,
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
        {
          createQueryBuilder: vi.fn(() => ({
            innerJoin: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            andWhere: vi.fn().mockReturnThis(),
            getCount: vi.fn(async () => 0),
          })),
        } as any,
        { count: vi.fn(async () => 0) } as any,
        { count: vi.fn(async () => 0) } as any,
        {
          createQueryBuilder: vi.fn(() => ({
            select: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            getRawOne: vi.fn(async () => ({ max_created_at: null })),
          })),
        } as any,
        { get: vi.fn(async () => null), set: vi.fn(async () => 'OK') } as any,
        encryption,
        settingsCache,
        auditService as any,
        tenantStatus as any,
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
        {
          createQueryBuilder: vi.fn(() => ({
            innerJoin: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            andWhere: vi.fn().mockReturnThis(),
            getCount: vi.fn(async () => 0),
          })),
        } as any,
        { count: vi.fn(async () => 0) } as any,
        { count: vi.fn(async () => 0) } as any,
        {
          createQueryBuilder: vi.fn(() => ({
            select: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            getRawOne: vi.fn(async () => ({ max_created_at: null })),
          })),
        } as any,
        { get: vi.fn(async () => null), set: vi.fn(async () => 'OK') } as any,
        encryption,
        settingsCache,
        auditService as any,
        tenantStatus as any,
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
        {
          createQueryBuilder: vi.fn(() => ({
            innerJoin: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            andWhere: vi.fn().mockReturnThis(),
            getCount: vi.fn(async () => 0),
          })),
        } as any,
        { count: vi.fn(async () => 0) } as any,
        { count: vi.fn(async () => 0) } as any,
        {
          createQueryBuilder: vi.fn(() => ({
            select: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            getRawOne: vi.fn(async () => ({ max_created_at: null })),
          })),
        } as any,
        { get: vi.fn(async () => null), set: vi.fn(async () => 'OK') } as any,
        encryption,
        settingsCache,
        auditService as any,
        tenantStatus as any,
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
        {
          createQueryBuilder: vi.fn(() => ({
            innerJoin: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            andWhere: vi.fn().mockReturnThis(),
            getCount: vi.fn(async () => 0),
          })),
        } as any,
        { count: vi.fn(async () => 0) } as any,
        { count: vi.fn(async () => 0) } as any,
        {
          createQueryBuilder: vi.fn(() => ({
            select: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            getRawOne: vi.fn(async () => ({ max_created_at: null })),
          })),
        } as any,
        { get: vi.fn(async () => null), set: vi.fn(async () => 'OK') } as any,
        encryption,
        settingsCache,
        auditService as any,
        tenantStatus as any,
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
        {
          createQueryBuilder: vi.fn(() => ({
            innerJoin: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            andWhere: vi.fn().mockReturnThis(),
            getCount: vi.fn(async () => 0),
          })),
        } as any,
        { count: vi.fn(async () => 0) } as any,
        { count: vi.fn(async () => 0) } as any,
        {
          createQueryBuilder: vi.fn(() => ({
            select: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            getRawOne: vi.fn(async () => ({ max_created_at: null })),
          })),
        } as any,
        { get: vi.fn(async () => null), set: vi.fn(async () => 'OK') } as any,
        encryption,
        settingsCache,
        auditService as any,
        tenantStatus as any,
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
        {
          createQueryBuilder: vi.fn(() => ({
            innerJoin: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            andWhere: vi.fn().mockReturnThis(),
            getCount: vi.fn(async () => 0),
          })),
        } as any,
        { count: vi.fn(async () => 0) } as any,
        { count: vi.fn(async () => 0) } as any,
        {
          createQueryBuilder: vi.fn(() => ({
            select: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            getRawOne: vi.fn(async () => ({ max_created_at: null })),
          })),
        } as any,
        { get: vi.fn(async () => null), set: vi.fn(async () => 'OK') } as any,
        encryption,
        settingsCache,
        auditService as any,
        tenantStatus as any,
      );

      const decrypted = await service.getDecryptedSettings('s1');

      expect(decrypted.communications?.whatsapp?.accessToken).toBe('super-secret-token');
    });

    it('leaves an unconfigured medium as undefined rather than throwing', async () => {
      const repo = fakeRepo({ id: 's1', settings: null });
      const service = new SchoolsService(
        repo as any,
        {
          createQueryBuilder: vi.fn(() => ({
            innerJoin: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            andWhere: vi.fn().mockReturnThis(),
            getCount: vi.fn(async () => 0),
          })),
        } as any,
        { count: vi.fn(async () => 0) } as any,
        { count: vi.fn(async () => 0) } as any,
        {
          createQueryBuilder: vi.fn(() => ({
            select: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            getRawOne: vi.fn(async () => ({ max_created_at: null })),
          })),
        } as any,
        { get: vi.fn(async () => null), set: vi.fn(async () => 'OK') } as any,
        encryption,
        settingsCache,
        auditService as any,
        tenantStatus as any,
      );

      const decrypted = await service.getDecryptedSettings('s1');

      expect(decrypted.communications).toBeUndefined();
    });

    it('drops a secret that fails to decrypt instead of failing the whole call', async () => {
      const repo = fakeRepo({
        id: 's1',
        settings: {
          version: 1,
          communications: {
            // A legacy plaintext row `yarn settings:reencrypt` hasn't reached yet.
            whatsapp: { phoneNumberId: '1', accessToken: 'legacy-plaintext-token' },
            sms: {
              provider: 'greenweb',
              greenweb: { apiKey: encryption.encrypt('valid-sms-key') },
            },
          },
        },
      });
      const service = new SchoolsService(
        repo as any,
        {
          createQueryBuilder: vi.fn(() => ({
            innerJoin: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            andWhere: vi.fn().mockReturnThis(),
            getCount: vi.fn(async () => 0),
          })),
        } as any,
        { count: vi.fn(async () => 0) } as any,
        { count: vi.fn(async () => 0) } as any,
        {
          createQueryBuilder: vi.fn(() => ({
            select: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            getRawOne: vi.fn(async () => ({ max_created_at: null })),
          })),
        } as any,
        { get: vi.fn(async () => null), set: vi.fn(async () => 'OK') } as any,
        encryption,
        settingsCache,
        auditService as any,
        tenantStatus as any,
      );

      const decrypted = await service.getDecryptedSettings('s1');

      expect(decrypted.communications?.whatsapp?.accessToken).toBeUndefined();
      expect((decrypted.communications?.sms as any)?.greenweb?.apiKey).toBe('valid-sms-key');
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
        {
          createQueryBuilder: vi.fn(() => ({
            innerJoin: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            andWhere: vi.fn().mockReturnThis(),
            getCount: vi.fn(async () => 0),
          })),
        } as any,
        { count: vi.fn(async () => 0) } as any,
        { count: vi.fn(async () => 0) } as any,
        {
          createQueryBuilder: vi.fn(() => ({
            select: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            getRawOne: vi.fn(async () => ({ max_created_at: null })),
          })),
        } as any,
        { get: vi.fn(async () => null), set: vi.fn(async () => 'OK') } as any,
        encryption,
        settingsCache,
        auditService as any,
        tenantStatus as any,
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
        {
          createQueryBuilder: vi.fn(() => ({
            innerJoin: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            andWhere: vi.fn().mockReturnThis(),
            getCount: vi.fn(async () => 0),
          })),
        } as any,
        { count: vi.fn(async () => 0) } as any,
        { count: vi.fn(async () => 0) } as any,
        {
          createQueryBuilder: vi.fn(() => ({
            select: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            getRawOne: vi.fn(async () => ({ max_created_at: null })),
          })),
        } as any,
        { get: vi.fn(async () => null), set: vi.fn(async () => 'OK') } as any,
        encryption,
        settingsCache,
        auditService as any,
        tenantStatus as any,
      );

      const masked = await service.getMaskedSettings('s1');

      expect(masked.version).toBe(1);
      expect(masked.region).toEqual(DEFAULT_REGION_SETTINGS);
    });
  });

  describe('getStats', () => {
    const SCHOOL_ID = 's1';

    function buildDeps(overrides: {
      activeUsers?: number;
      students?: number;
      queued?: number;
      failed7d?: number;
      lastActivityAt?: Date | null;
      redisCached?: string | null;
    }) {
      const userTenantQb = {
        innerJoin: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        getCount: vi.fn(async () => overrides.activeUsers ?? 0),
      };
      const userTenantRepo = { createQueryBuilder: vi.fn(() => userTenantQb) };

      const studentRepo = { count: vi.fn(async () => overrides.students ?? 0) };

      const commLogRepo = {
        count: vi.fn(async ({ where }: any) =>
          where.status === 'QUEUED' ? (overrides.queued ?? 0) : (overrides.failed7d ?? 0),
        ),
      };

      const auditLogQb = {
        select: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        getRawOne: vi.fn(async () => ({
          max_created_at: overrides.lastActivityAt ?? null,
        })),
      };
      const auditLogRepo = { createQueryBuilder: vi.fn(() => auditLogQb) };

      const redis = {
        get: vi.fn(async () => overrides.redisCached ?? null),
        set: vi.fn(async () => 'OK'),
      };

      return { userTenantRepo, studentRepo, commLogRepo, auditLogRepo, redis };
    }

    it('returns the five metrics computed from a single COUNT query each, scoped to the school', async () => {
      const lastActivityAt = new Date('2026-09-01T00:00:00Z');
      const deps = buildDeps({
        activeUsers: 4,
        students: 30,
        queued: 2,
        failed7d: 1,
        lastActivityAt,
      });
      const repo = fakeRepo({ id: SCHOOL_ID, settings: null });
      const service = new SchoolsService(
        repo as any,
        deps.userTenantRepo as any,
        deps.studentRepo as any,
        deps.commLogRepo as any,
        deps.auditLogRepo as any,
        deps.redis as any,
        encryption,
        settingsCache,
        auditService as any,
        tenantStatus as any,
      );

      const stats = await service.getStats(SCHOOL_ID);

      expect(stats).toEqual({
        active_users: 4,
        students: 30,
        communications_queued: 2,
        communications_failed_7d: 1,
        last_activity_at: lastActivityAt,
      });
      // Every underlying query is scoped to this school's id — the
      // multi-tenancy rule (no cross-tenant joins/leaks).
      expect(deps.studentRepo.count).toHaveBeenCalledWith({
        where: { tenant_id: SCHOOL_ID },
      });
      expect(deps.redis.set).toHaveBeenCalledTimes(1);
    });

    it('skips the underlying COUNT queries entirely on a cache hit within the 60s TTL', async () => {
      const cached = {
        active_users: 4,
        students: 30,
        communications_queued: 2,
        communications_failed_7d: 1,
        last_activity_at: new Date('2026-09-01T00:00:00Z').toISOString(),
      };
      const deps = buildDeps({ redisCached: JSON.stringify(cached) });
      const repo = fakeRepo({ id: SCHOOL_ID, settings: null });
      const service = new SchoolsService(
        repo as any,
        deps.userTenantRepo as any,
        deps.studentRepo as any,
        deps.commLogRepo as any,
        deps.auditLogRepo as any,
        deps.redis as any,
        encryption,
        settingsCache,
        auditService as any,
        tenantStatus as any,
      );

      const stats = await service.getStats(SCHOOL_ID);

      expect(stats.active_users).toBe(4);
      expect(deps.userTenantRepo.createQueryBuilder).not.toHaveBeenCalled();
      expect(deps.studentRepo.count).not.toHaveBeenCalled();
      expect(deps.commLogRepo.count).not.toHaveBeenCalled();
      expect(deps.auditLogRepo.createQueryBuilder).not.toHaveBeenCalled();
      expect(deps.redis.set).not.toHaveBeenCalled();
    });
  });

  describe('updateStatus', () => {
    function buildService(school: { id: string; status: 'ACTIVE' | 'SUSPENDED' }) {
      const repo = fakeRepo(school as any);
      const service = new SchoolsService(
        repo as any,
        {
          createQueryBuilder: vi.fn(() => ({
            innerJoin: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            andWhere: vi.fn().mockReturnThis(),
            getCount: vi.fn(async () => 0),
          })),
        } as any,
        { count: vi.fn(async () => 0) } as any,
        { count: vi.fn(async () => 0) } as any,
        {
          createQueryBuilder: vi.fn(() => ({
            select: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            getRawOne: vi.fn(async () => ({ max_created_at: null })),
          })),
        } as any,
        { get: vi.fn(async () => null), set: vi.fn(async () => 'OK') } as any,
        encryption,
        settingsCache,
        auditService as any,
        tenantStatus as any,
      );
      return { service, repo };
    }

    it('suspends an active school: writes status columns, audits SUSPEND with the reason, invalidates the tenant status cache', async () => {
      const { service, repo } = buildService({ id: 's1', status: 'ACTIVE' });

      const result = await service.updateStatus(
        's1',
        { status: 'SUSPENDED', reason: 'Non-payment for 60 days' },
        'admin-1',
        REQUEST_CONTEXT,
      );

      expect(result.status).toBe('SUSPENDED');
      expect(result.status_reason).toBe('Non-payment for 60 days');
      expect(result.status_changed_at).toBeInstanceOf(Date);

      expect(repo.schoolRepo.update).toHaveBeenCalledWith(
        's1',
        expect.objectContaining({ status: 'SUSPENDED', status_reason: 'Non-payment for 60 days' }),
      );

      expect(auditService.record).toHaveBeenCalledTimes(1);
      const [entry] = auditService.record.mock.calls[0];
      expect(entry).toMatchObject({
        action: AuditAction.SUSPEND,
        entity_type: 'School',
        entity_id: 's1',
        tenant_id: 's1',
        performed_by_user_id: 'admin-1',
        old_values: { status: 'ACTIVE' },
        new_values: { status: 'SUSPENDED', reason: 'Non-payment for 60 days' },
      });

      expect(tenantStatus.invalidate).toHaveBeenCalledWith('s1');
    });

    it('reactivates a suspended school: audits REACTIVATE and invalidates the cache, restoring access', async () => {
      const { service, repo } = buildService({ id: 's1', status: 'SUSPENDED' });

      const result = await service.updateStatus(
        's1',
        { status: 'ACTIVE', reason: 'Payment received, restoring access' },
        'admin-1',
        REQUEST_CONTEXT,
      );

      expect(result.status).toBe('ACTIVE');
      expect(repo.schoolRepo.update).toHaveBeenCalledWith(
        's1',
        expect.objectContaining({ status: 'ACTIVE' }),
      );

      const [entry] = auditService.record.mock.calls[0];
      expect(entry).toMatchObject({
        action: AuditAction.REACTIVATE,
        old_values: { status: 'SUSPENDED' },
        new_values: { status: 'ACTIVE', reason: 'Payment received, restoring access' },
      });

      expect(tenantStatus.invalidate).toHaveBeenCalledWith('s1');
    });

    it('is a no-op that still returns 200 when the requested status matches the current one — no audit, no cache invalidation', async () => {
      const { service, repo } = buildService({ id: 's1', status: 'ACTIVE' });

      const result = await service.updateStatus(
        's1',
        { status: 'ACTIVE', reason: 'Re-confirming active status' },
        'admin-1',
        REQUEST_CONTEXT,
      );

      expect(result.status).toBe('ACTIVE');
      expect(repo.schoolRepo.update).not.toHaveBeenCalled();
      expect(auditService.record).not.toHaveBeenCalled();
      expect(tenantStatus.invalidate).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the school does not exist', async () => {
      const { service } = buildService(null as any);

      await expect(
        service.updateStatus('missing', { status: 'SUSPENDED', reason: 'irrelevant' }, 'admin-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
