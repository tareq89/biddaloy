import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Repository, DataSource } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import { plainToInstance } from 'class-transformer';
import { randomBytes, randomUUID } from 'crypto';
import { AuditAction } from '@biddaloy/shared';
import { SchoolsService } from './schools.service';
import { School } from './entities/school.entity';
import { TenantSettingsDto } from './dto/tenant-settings.dto';
import { EncryptionService } from './settings/encryption.service';
import { TenantSettingsCache } from './settings/tenant-settings-cache.service';
import { TenantStatusModule } from './tenant-status.module';
import { AuditService } from '../audit/audit.service';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { User } from '../users/entities/user.entity';
import { Class } from '../academics/entities/class.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
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
      [TenantStatusModule],
      { synchronize: true, dropSchema: true },
    );

    service = module.get<SchoolsService>(SchoolsService);
    schoolRepo = module.get<Repository<School>>(getRepositoryToken(School));
    auditLogRepo = module.get<Repository<AuditLog>>(getRepositoryToken(AuditLog));
    dataSource = module.get(DataSource);

    // [33.3.1] `class.entity.ts` deliberately does not declare the
    // `NULLS NOT DISTINCT` unique index via `@Index` — TypeORM's decorator
    // can't express it, so `1789800010700-AddOrganisationDimensions.ts` is
    // the source of truth, not `synchronize: true` above. This module runs
    // no migrations, so it's created by hand, matching that migration's
    // `up()` — same as `classes.service.integration.spec.ts`.
    await dataSource.query(
      `CREATE UNIQUE INDEX "IDX_cl_name_year_tenant_shift_version" ON "classes" ("name", "academic_year_id", "tenant_id", "shift", "version") NULLS NOT DISTINCT`,
    );

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
      // FK-safe order — children of `schools` before the row itself.
      await dataSource.query('DELETE FROM class_sections');
      await dataSource.query('DELETE FROM classes');
      await dataSource.query('DELETE FROM academic_years');
      await dataSource.query('DELETE FROM schools');
    }
  });

  async function createSchool(): Promise<School> {
    return schoolRepo.save(
      schoolRepo.create({ id: randomUUID(), name: 'Test School', slug: `school-${randomUUID()}` }),
    );
  }

  it('[15.4] defaults a new School to status ACTIVE', async () => {
    const school = await createSchool();
    expect(school.status).toBe('ACTIVE');

    const reloaded = await schoolRepo.findOneByOrFail({ id: school.id });
    expect(reloaded.status).toBe('ACTIVE');
    expect(reloaded.status_reason).toBeNull();
    expect(reloaded.status_changed_at).toBeNull();
  });

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

  /**
   * [33.3.1, money-tier review] Real-Postgres coverage the unit specs
   * (`schools.service.spec.ts`) can't provide — a mocked `manager` can
   * assert "both calls happened before the mocked save threw", but only a
   * real transaction can prove the row rewrite actually rolls back, and
   * only a real unique index can prove a rename collision surfaces as a
   * `ConflictException` rather than an unhandled 500.
   */
  describe('organisation vocabulary guard/rename', () => {
    async function createSchoolWithClass(shift: string) {
      const school = await createSchool();
      await schoolRepo.update(school.id, {
        settings: { version: 1, organisation: { shifts: [shift], versions: [], groups: [] } },
      });
      const yearRepo = dataSource.getRepository(AcademicYear);
      const year = await yearRepo.save({
        name: '2026-2027',
        start_date: '2026-01-01',
        end_date: '2026-12-31',
        tenant_id: school.id,
      });
      const classRepo = dataSource.getRepository(Class);
      const klass = await classRepo.save({
        name: 'Class A',
        academic_year_id: year.id,
        tenant_id: school.id,
        shift,
      });
      return { school, year, klass };
    }

    it('rewrites rows and saves settings together, and both persist after commit', async () => {
      const { school, klass } = await createSchoolWithClass('Day');

      const patch = plainToInstance(TenantSettingsDto, {
        version: 1,
        organisation: { shifts: ['Prohor'], versions: [], groups: [] },
        organisationRenames: [{ list: 'shifts', from: 'Day', to: 'Prohor' }],
      });
      await service.updateSettings(school.id, patch, SEED_ADMIN_USER_ID);

      const classRepo = dataSource.getRepository(Class);
      const reloadedClass = await classRepo.findOneOrFail({ where: { id: klass.id } });
      expect(reloadedClass.shift).toBe('Prohor');

      const reloadedSchool = await schoolRepo.findOneOrFail({ where: { id: school.id } });
      expect((reloadedSchool.settings as any).organisation.shifts).toEqual(['Prohor']);
    });

    it('rolls back the row rewrite together with the settings save when the write fails mid-transaction', async () => {
      const { school, klass } = await createSchoolWithClass('Day');

      const patch = plainToInstance(TenantSettingsDto, {
        version: 1,
        organisation: { shifts: ['Prohor'], versions: [], groups: [] },
        organisationRenames: [{ list: 'shifts', from: 'Day', to: 'Prohor' }],
      });

      // Same FK-violation trick as the audit-rollback test above — a real
      // Postgres failure inside the same transaction as the row rewrite,
      // not a mock.
      await expect(service.updateSettings(school.id, patch, randomUUID())).rejects.toThrow();

      const classRepo = dataSource.getRepository(Class);
      const reloadedClass = await classRepo.findOneOrFail({ where: { id: klass.id } });
      expect(reloadedClass.shift).toBe('Day');

      const reloadedSchool = await schoolRepo.findOneOrFail({ where: { id: school.id } });
      expect((reloadedSchool.settings as any).organisation.shifts).toEqual(['Day']);
    });

    it('maps a rename target colliding with an existing row to a 4xx, not a 500', async () => {
      const school = await createSchool();
      await schoolRepo.update(school.id, {
        settings: {
          version: 1,
          organisation: { shifts: ['Morning', 'Day'], versions: [], groups: [] },
        },
      });
      const yearRepo = dataSource.getRepository(AcademicYear);
      const year = await yearRepo.save({
        name: '2026-2027',
        start_date: '2026-01-01',
        end_date: '2026-12-31',
        tenant_id: school.id,
      });
      const classRepo = dataSource.getRepository(Class);
      // Same name/year, different shift — a Morning->Day rename would
      // rewrite this row's shift into direct collision with the other one.
      await classRepo.save({
        name: 'Class A',
        academic_year_id: year.id,
        tenant_id: school.id,
        shift: 'Morning',
      });
      await classRepo.save({
        name: 'Class A',
        academic_year_id: year.id,
        tenant_id: school.id,
        shift: 'Day',
      });

      const patch = plainToInstance(TenantSettingsDto, {
        version: 1,
        organisation: { shifts: ['Day'], versions: [], groups: [] },
        organisationRenames: [{ list: 'shifts', from: 'Morning', to: 'Day' }],
      });

      // Bug 2's *first* guard (reject `to` already in `oldOrg`) already
      // catches this exact case before any row is touched — this proves
      // the outcome is a clean 4xx either way, not a raw 500 from the
      // unique index.
      await expect(
        service.updateSettings(school.id, patch, SEED_ADMIN_USER_ID),
      ).rejects.toMatchObject({ status: 400 });
    });
  });
});
