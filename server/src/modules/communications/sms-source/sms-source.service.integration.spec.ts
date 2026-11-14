import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { DataSource, Repository } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { User } from '../../users/entities/user.entity';
import { AuditAction, CommunicationMedium } from '@biddaloy/shared';
import { SmsSourceService } from './sms-source.service';
import { School } from '../../schools/entities/school.entity';
import { TenantSettingsCache } from '../../schools/settings/tenant-settings-cache.service';
import { problemWith } from '../../schools/settings/messaging-settings.validator';
import { AuditService } from '../../audit/audit.service';
import { AuditLog } from '../../audit/entities/audit-log.entity';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { SEED_ADMIN_USER_ID, SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD_HASH } from '@test/constants';

describe('SmsSourceService (integration)', () => {
  let service: SmsSourceService;
  let schoolRepo: Repository<School>;
  let auditRepo: Repository<AuditLog>;
  let dataSource: DataSource;

  beforeAll(async () => {
    const module = await createTestModule(
      ALL_ENTITIES,
      [
        SmsSourceService,
        AuditService,
        { provide: TenantSettingsCache, useFactory: () => new TenantSettingsCache(30_000) },
      ],
      [],
      { synchronize: true, dropSchema: true },
    );
    service = module.get(SmsSourceService);
    schoolRepo = module.get(getRepositoryToken(School));
    auditRepo = module.get(getRepositoryToken(AuditLog));
    dataSource = module.get(DataSource);
    // audit_logs.performed_by_user_id is a FK, so the actor must be a real user.
    const users = dataSource.getRepository(User);
    await users.save(
      users.create({
        id: SEED_ADMIN_USER_ID,
        email: SEED_ADMIN_EMAIL,
        password_hash: SEED_ADMIN_PASSWORD_HASH,
        full_name: 'Test Admin',
      }),
    );
  }, 60000);

  afterAll(async () => {
    await dataSource?.destroy();
  });

  beforeEach(async () => {
    await dataSource.query('DELETE FROM audit_logs');
    await dataSource.query('DELETE FROM schools');
  });

  const ownBlock = { apiKey: 'enc:v1:abc', senderId: 'S1', apiUrl: 'https://m.example/api' };
  const makeSchool = (settings: Record<string, unknown> | null = null) =>
    schoolRepo.save(
      schoolRepo.create({
        id: randomUUID(),
        name: 'SMS Source School',
        slug: `s-${randomUUID()}`,
        settings,
      }),
    );
  const reload = async (id: string) => (await schoolRepo.findOneByOrFail({ id })).settings;
  const audits = (id: string) =>
    auditRepo.find({ where: { entity_id: id, action: AuditAction.SMS_SOURCE_CHANGED } });

  it('writes source + metering, audits old/new only', async () => {
    const school = await makeSchool({
      version: 1,
      communications: { sms: { provider: 'mimsms', mimsms: ownBlock } },
    });
    const r = await service.set(school.id, 'SCHOOLMANAGERP', SEED_ADMIN_USER_ID);
    expect(r).toEqual({ source: 'SCHOOLMANAGERP', ownProviderSaved: true });
    const sms = (await reload(school.id))!.communications.sms;
    expect(sms).toMatchObject({ source: 'SCHOOLMANAGERP', metering: 'PLATFORM' });
    const rows = await audits(school.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].old_values).toEqual({ source: 'OWN' });
    expect(rows[0].new_values).toEqual({ source: 'SCHOOLMANAGERP' });
  });

  it('switching away and back leaves the own block byte-identical', async () => {
    const school = await makeSchool({
      version: 1,
      communications: { sms: { provider: 'mimsms', mimsms: ownBlock } },
    });
    const before = JSON.stringify((await reload(school.id))!.communications.sms.mimsms);
    await service.set(school.id, 'SCHOOLMANAGERP', SEED_ADMIN_USER_ID);
    await service.set(school.id, 'OWN', SEED_ADMIN_USER_ID);
    const sms = (await reload(school.id))!.communications.sms;
    expect(JSON.stringify(sms.mimsms)).toBe(before);
    expect(sms).toMatchObject({ source: 'OWN', metering: 'OFF', provider: 'mimsms' });
    expect(await audits(school.id)).toHaveLength(2);
  });

  it('same value again: no-op, no audit row, nothing written', async () => {
    const school = await makeSchool(null);
    await service.set(school.id, 'OWN', SEED_ADMIN_USER_ID);
    expect(await audits(school.id)).toHaveLength(0);
    expect(await reload(school.id)).toBeNull();
  });

  it("only touches the caller's own school (cross-tenant)", async () => {
    const a = await makeSchool({ version: 1 });
    const b = await makeSchool({ version: 1 });
    await service.set(a.id, 'SCHOOLMANAGERP', SEED_ADMIN_USER_ID);
    expect((await reload(b.id))!.communications).toBeUndefined();
    expect((await reload(a.id))!.communications.sms.source).toBe('SCHOOLMANAGERP');
  });

  it('the generic PATCH validator refuses `source`; the stored value stays', async () => {
    const school = await makeSchool({ version: 1 });
    await service.set(school.id, 'SCHOOLMANAGERP', SEED_ADMIN_USER_ID);
    // The settings DTO runs this check before any write, so a refusal means no write.
    expect(problemWith({ source: 'OWN' }, CommunicationMedium.SMS)).toBe(
      'has a setting this channel does not use.',
    );
    expect((await reload(school.id))!.communications.sms.source).toBe('SCHOOLMANAGERP');
  });
});
