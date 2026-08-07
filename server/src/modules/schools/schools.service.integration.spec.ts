import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Repository, DataSource } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import { plainToInstance } from 'class-transformer';
import { randomBytes, randomUUID } from 'crypto';
import { AuditAction } from '@beton-boi/shared';
import { SchoolsService } from './schools.service';
import { School } from './entities/school.entity';
import { TenantSettingsDto } from './dto/tenant-settings.dto';
import { EncryptionService } from './settings/encryption.service';
import { TenantSettingsCache } from './settings/tenant-settings-cache.service';
import { AuditService } from '../audit/audit.service';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { User } from '../users/entities/user.entity';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { SEED_ADMIN_USER_ID, SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD_HASH } from '@test/constants';

/**
 * Integration tests for #8.7.11 (settings audit trail and secret
 * redaction) against a real Postgres database — the unit tests in
 * `schools.service.spec.ts` mock `manager.transaction`, so they can't
 * exercise a genuine FK-violation rollback the way this suite can, and
 * "no secret reaches ... an error response" (the issue's own acceptance
 * criterion) has to be asserted against the actual stored row, not the
 * ORM's in-memory mapping of it.
 */
describe('SchoolsService (integration)', () => {
  let service: SchoolsService;
  let schoolRepo: Repository<School>;
  let auditLogRepo: Repository<AuditLog>;
  let dataSource: DataSource;

  beforeAll(async () => {
    const module = await createTestModule(
      ALL_ENTITIES,
      [
        SchoolsService,
        AuditService,
        { provide: EncryptionService, useFactory: () => new EncryptionService(randomBytes(32)) },
        { provide: TenantSettingsCache, useFactory: () => new TenantSettingsCache(30_000) },
      ],
      [],
      { synchronize: true, dropSchema: true },
    );

    service = module.get<SchoolsService>(SchoolsService);
    schoolRepo = module.get<Repository<School>>(getRepositoryToken(School));
    auditLogRepo = module.get<Repository<AuditLog>>(getRepositoryToken(AuditLog));
    dataSource = module.get(DataSource);

    const userRepo = dataSource.getRepository(User);
    await userRepo.save(
      userRepo.create({
        id: SEED_ADMIN_USER_ID,
        email: SEED_ADMIN_EMAIL,
        password_hash: SEED_ADMIN_PASSWORD_HASH,
        full_name: 'Test Admin',
      }),
    );
  }, 60000);

  afterAll(async () => {
    if (dataSource) {
      await dataSource.destroy();
    }
  });

  beforeEach(async () => {
    if (dataSource) {
      await dataSource.query('DELETE FROM audit_logs');
      await dataSource.query('DELETE FROM schools');
    }
  });

  async function createSchool(): Promise<School> {
    return schoolRepo.save(
      schoolRepo.create({ id: randomUUID(), name: 'Test School', slug: `school-${randomUUID()}` }),
    );
  }

  it('writes a SETTINGS_CHANGE audit entry with actor, tenant, and timestamp', async () => {
    const school = await createSchool();
    const patch = plainToInstance(TenantSettingsDto, {
      version: 1,
      communications: { whatsapp: { phoneNumberId: '123', accessToken: 'super-secret-token' } },
    });

    await service.updateSettings(school.id, patch, SEED_ADMIN_USER_ID, {
      ip: '10.0.0.1',
      userAgent: 'vitest',
    });

    const logs = await auditLogRepo.find({ where: { entity_id: school.id } });
    expect(logs).toHaveLength(1);
    expect(logs[0].action).toBe(AuditAction.SETTINGS_CHANGE);
    expect(logs[0].entity_type).toBe('School');
    expect(logs[0].tenant_id).toBe(school.id);
    expect(logs[0].performed_by_user_id).toBe(SEED_ADMIN_USER_ID);
    expect(logs[0].ip_address).toBe('10.0.0.1');
    expect(logs[0].user_agent).toBe('vitest');
    expect(logs[0].created_at).toBeInstanceOf(Date);
  });

  it('never stores the secret value in the audit diff, asserted against the raw stored row', async () => {
    const school = await createSchool();
    const patch = plainToInstance(TenantSettingsDto, {
      version: 1,
      communications: { whatsapp: { phoneNumberId: '123', accessToken: 'super-secret-token' } },
    });

    await service.updateSettings(school.id, patch, SEED_ADMIN_USER_ID);

    const [log] = await auditLogRepo.find({ where: { entity_id: school.id } });
    expect((log.new_values as any).communications.whatsapp.accessToken).toBe('[REDACTED]');
    expect(JSON.stringify(log)).not.toContain('super-secret-token');

    // Query the raw column directly rather than through the ORM's own
    // deserialization, so a leak surviving re-serialization wouldn't be
    // masked by however TypeORM happens to map jsonb back to an object.
    const [{ new_values }] = await dataSource.query(
      'SELECT new_values FROM audit_logs WHERE entity_id = $1',
      [school.id],
    );
    expect(JSON.stringify(new_values)).not.toContain('super-secret-token');
  });

  it('scopes the diff to the changed section and never stores the prior secret either', async () => {
    const school = await createSchool();
    await service.updateSettings(
      school.id,
      plainToInstance(TenantSettingsDto, {
        version: 1,
        communications: { whatsapp: { phoneNumberId: '123', accessToken: 'first-secret' } },
      }),
      SEED_ADMIN_USER_ID,
    );

    await service.updateSettings(
      school.id,
      plainToInstance(TenantSettingsDto, {
        version: 1,
        communications: { whatsapp: { phoneNumberId: '456', accessToken: 'second-secret' } },
      }),
      SEED_ADMIN_USER_ID,
    );

    const logs = await auditLogRepo.find({
      where: { entity_id: school.id },
      order: { created_at: 'ASC' },
    });
    expect(logs).toHaveLength(2);

    const secondLog = logs[1];
    expect((secondLog.old_values as any).communications.whatsapp.phoneNumberId).toBe('123');
    expect((secondLog.old_values as any).communications.whatsapp.accessToken).toBe('[REDACTED]');
    expect((secondLog.new_values as any).communications.whatsapp.phoneNumberId).toBe('456');
    expect((secondLog.new_values as any).communications.whatsapp.accessToken).toBe('[REDACTED]');
    expect(JSON.stringify(secondLog)).not.toContain('first-secret');
    expect(JSON.stringify(secondLog)).not.toContain('second-secret');
  });

  it('rolls back the settings save when the audit write fails, in the same transaction', async () => {
    const school = await createSchool();
    const patch = plainToInstance(TenantSettingsDto, {
      version: 1,
      communications: { whatsapp: { phoneNumberId: '123', accessToken: 'tok' } },
    });

    // A performed_by_user_id that references no real user violates
    // audit_logs' FK constraint at INSERT time — a real Postgres failure
    // inside AuditService.record's manager.save(), not a mock, that should
    // take the whole transaction (including the settings save) down with
    // it rather than leaving an untracked mutation.
    await expect(service.updateSettings(school.id, patch, randomUUID())).rejects.toThrow();

    const reloaded = await schoolRepo.findOne({ where: { id: school.id } });
    expect(reloaded?.settings).toBeNull();
    const logs = await auditLogRepo.find({ where: { entity_id: school.id } });
    expect(logs).toHaveLength(0);
  });
});
