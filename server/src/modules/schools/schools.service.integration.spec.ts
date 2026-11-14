import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Repository, DataSource } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import { plainToInstance } from 'class-transformer';
import { randomBytes, randomUUID } from 'crypto';
import {
  AuditAction,
  PlacementAlgorithm,
  PromotionOutcome,
  PromotionRunStatus,
} from '@biddaloy/shared';
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
import { ClassSubject } from '../academics/entities/class-subject.entity';
import { Subject } from '../academics/entities/subject.entity';
import { PromotionRun } from '../promotions/entities/promotion-run.entity';
import { PromotionEntry } from '../promotions/entities/promotion-entry.entity';
import { attentionKeys } from '../attention/attention.constants';
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
    // `up()` (as replaced by `1791900000400-CaseInsensitiveAcademicNames.ts`, `lower("name")` key; live-only via `1791900000500-ClassNameUniqueLiveOnly.ts`) — same as `classes.service.integration.spec.ts`.
    await dataSource.query(
      `CREATE UNIQUE INDEX "IDX_cl_name_year_tenant_shift_version" ON "classes" (lower("name"), "academic_year_id", "tenant_id", "shift", "version") NULLS NOT DISTINCT WHERE "deleted_at" IS NULL`,
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

  describe('[77.2.10] a modules change drops the attention bar cache', () => {
    it("deletes that school's cached bar summaries on a modules write, not on a labels write", async () => {
      const redis = service['redis'];
      const school = await createSchool();
      const other = await createSchool();
      const mine = attentionKeys.summary(school.id, SEED_ADMIN_USER_ID, 'ADMIN');
      const mine2 = attentionKeys.summary(school.id, randomUUID(), 'TEACHER');
      const theirs = attentionKeys.summary(other.id, SEED_ADMIN_USER_ID, 'ADMIN');
      for (const k of [mine, mine2, theirs]) await redis.set(k, '{}', 'EX', 60);

      // Words do not change which alerts show: cache stays.
      await service.updateSettings(
        school.id,
        Object.assign(new TenantSettingsDto(), { labels: { student: { bn: 'শিক্ষার্থী' } } }),
        SEED_ADMIN_USER_ID,
      );
      expect(await redis.exists(mine, mine2, theirs)).toBe(3);

      await service.updateSettings(
        school.id,
        Object.assign(new TenantSettingsDto(), { modules: { fees: { on: false } } }),
        SEED_ADMIN_USER_ID,
      );
      expect(await redis.exists(mine, mine2)).toBe(0);
      expect(await redis.exists(theirs)).toBe(1); // another school's bar is untouched
      await redis.del(theirs);
    });
  });

  describe('[Epic 99 #3805] searchForPlatform', () => {
    // A unique tag in every name keeps these rows apart from other tests' schools.
    async function seedSearch(over: Partial<School> = {}): Promise<School> {
      return schoolRepo.save(
        schoolRepo.create({ id: randomUUID(), name: 'x', slug: `s-${randomUUID()}`, ...over }),
      );
    }
    const find = (q: Record<string, unknown>) => service.searchForPlatform(q as never);

    it('q matches name, slug and phone; % and _ are literal', async () => {
      const tag = randomUUID().slice(0, 8);
      const byName = await seedSearch({ name: `Alpha ${tag}` });
      const bySlug = await seedSearch({ name: 'n', slug: `zz-${tag}` });
      const byPhone = await seedSearch({ name: 'p', phone: `0${tag.slice(0, 6)}` });
      const pct = await seedSearch({ name: `100%_${tag}` });
      const ids = async (q: string) => (await find({ q })).items.map((i) => i.id);
      expect(await ids(`Alpha ${tag}`)).toEqual([byName.id]);
      expect(await ids(`zz-${tag}`)).toEqual([bySlug.id]);
      expect(await ids(`0${tag.slice(0, 6)}`)).toEqual([byPhone.id]);
      expect(await ids(`100%_${tag}`)).toEqual([pct.id]);
      // Escaped: a bare % must not act as a wildcard that matches everything.
      expect((await find({ q: '%' })).items.every((i) => i.name.includes('%'))).toBe(true);
      expect((await find({ q: `_lpha ${tag}` })).total).toBe(0);
    });

    it('status filters; a deleted school appears only with status=DELETED', async () => {
      const tag = randomUUID().slice(0, 8);
      const active = await seedSearch({ name: `A ${tag}` });
      const susp = await seedSearch({ name: `S ${tag}`, status: 'SUSPENDED' });
      const gone = await seedSearch({ name: `D ${tag}` });
      await schoolRepo.softDelete(gone.id);
      const ids = async (status?: string) =>
        (await find({ q: tag, status })).items.map((i) => i.id).sort();
      expect(await ids()).toEqual([active.id, susp.id].sort());
      expect(await ids('ACTIVE')).toEqual([active.id]);
      expect(await ids('SUSPENDED')).toEqual([susp.id]);
      expect(await ids('DELETED')).toEqual([gone.id]);
    });

    it('trial filter, sort and paging with total', async () => {
      const tag = randomUUID().slice(0, 8);
      const soon = await seedSearch({
        name: `B ${tag}`,
        trial_ends_at: new Date(Date.now() + 86_400_000),
      });
      const expired = await seedSearch({
        name: `C ${tag}`,
        status: 'SUSPENDED',
        status_reason: 'TRIAL_EXPIRED',
      });
      expect((await find({ q: tag, trial: 'active' })).items.map((i) => i.id)).toEqual([soon.id]);
      expect((await find({ q: tag, trial: 'expired' })).items.map((i) => i.id)).toEqual([
        expired.id,
      ]);
      const byName = await find({ q: tag, sort: 'name', limit: 1, page: 2 });
      expect(byName.total).toBe(2);
      expect(byName.items.map((i) => i.id)).toEqual([expired.id]);
      expect((await find({ q: tag, sort: 'trialEnd' })).items[0].id).toBe(soon.id);
    });

    it('students and lastActivity come from one grouped query', async () => {
      const tag = randomUUID().slice(0, 8);
      const quiet = await seedSearch({ name: `Q ${tag}` });
      const busy = await seedSearch({ name: `Z ${tag}` });
      await dataSource.query(
        `INSERT INTO audit_logs (id, action, entity_type, entity_id, tenant_id)
         VALUES ($1, 'CREATE', 'School', $2, $2)`,
        [randomUUID(), busy.id],
      );
      const res = await find({ q: tag, sort: 'lastActivity' });
      expect(res.items.map((i) => i.id)).toEqual([busy.id, quiet.id]);
      expect(res.items[0].lastActivityAt).not.toBeNull();
      expect(res.items[1].lastActivityAt).toBeNull();
      expect(res.items[1].studentCount).toBe(0);
    });
  });

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

  it('[48.1.03] stores settings.documents as sent and a later fees-only update leaves it', async () => {
    const school = await createSchool();
    const documents = { withholdAdmitCardForDues: true, serialPrefix: 'DAHS' };

    await service.updateSettings(
      school.id,
      plainToInstance(TenantSettingsDto, { version: 1, documents }),
      SEED_ADMIN_USER_ID,
    );
    expect((await schoolRepo.findOneByOrFail({ id: school.id })).settings?.documents).toEqual(
      documents,
    );

    await service.updateSettings(
      school.id,
      plainToInstance(TenantSettingsDto, { version: 1, fees: { approvalMode: 'OTP' } }),
      SEED_ADMIN_USER_ID,
    );
    expect((await schoolRepo.findOneByOrFail({ id: school.id })).settings?.documents).toEqual(
      documents,
    );
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
  describe('[3.1.03] settings.payments (D13/D47)', () => {
    const CREDS = {
      appKey: 'KEY-plain-1',
      appSecret: 'SECRET-plain-2',
      username: 'USER-plain-3',
      password: 'PASS-plain-4',
    };
    const patch = (payments: Record<string, unknown>) =>
      plainToInstance(TenantSettingsDto, { version: 1, payments });
    const stored = async (id: string) =>
      (await schoolRepo.findOneByOrFail({ id })).settings?.payments as any;
    // Stands in for the test-connection route (#3984), the only real writer of `lastTestOkAt`.
    const markTested = async (id: string) => {
      const school = await schoolRepo.findOneByOrFail({ id });
      const settings = school.settings as any;
      settings.payments.bkash.lastTestOkAt = '2026-01-01T00:00:00.000Z';
      school.settings = settings;
      await schoolRepo.save(school);
    };
    const REFUSAL = 'Test the bKash connection before turning online payments on.';

    it('encrypts the four secrets, masks the response, and keeps plaintext and ciphertext out of audit rows', async () => {
      const school = await createSchool();
      const res = await service.updateSettings(
        school.id,
        patch({ bkash: { environment: 'SANDBOX', ...CREDS } }),
        SEED_ADMIN_USER_ID,
      );
      for (const v of Object.values(CREDS)) expect(JSON.stringify(res)).not.toContain(v);
      expect((res.payments as any).bkash.appKey).toMatchObject({ configured: true });
      const raw = (await stored(school.id)).bkash;
      for (const [k, v] of Object.entries(CREDS)) {
        expect(raw[k]).not.toBe(v);
        expect(raw[k]).toEqual(expect.any(String));
      }
      const rows = await dataSource.query('SELECT old_values, new_values FROM audit_logs');
      const dump = JSON.stringify(rows);
      for (const v of Object.values(CREDS)) expect(dump).not.toContain(v);
      for (const k of Object.keys(CREDS)) expect(dump).not.toContain(raw[k]);
    });

    it('defaults both toggles off', async () => {
      const school = await createSchool();
      const res = await service.updateSettings(
        school.id,
        patch({ proofEnabled: false }),
        SEED_ADMIN_USER_ID,
      );
      expect(res.payments).toMatchObject({
        onlineEnabled: false,
        proofEnabled: false,
        proofMethods: [],
      });
    });

    it('refuses online without a passing test, with one fixed sentence that echoes nothing', async () => {
      const school = await createSchool();
      await service.updateSettings(school.id, patch({ bkash: CREDS }), SEED_ADMIN_USER_ID);
      const err = await service
        .updateSettings(school.id, patch({ onlineEnabled: true }), SEED_ADMIN_USER_ID)
        .catch((e) => e);
      expect(err.getStatus()).toBe(400);
      expect(err.message).toBe(REFUSAL);
      expect((await stored(school.id)).onlineEnabled).toBeUndefined();
    });

    it('allows online after a test, and ignores lastTestOkAt sent in a PATCH', async () => {
      const school = await createSchool();
      await service.updateSettings(
        school.id,
        patch({ bkash: { ...CREDS, lastTestOkAt: '2026-02-02T00:00:00.000Z' } }),
        SEED_ADMIN_USER_ID,
      );
      expect((await stored(school.id)).bkash.lastTestOkAt).toBeUndefined();
      await expect(
        service.updateSettings(school.id, patch({ onlineEnabled: true }), SEED_ADMIN_USER_ID),
      ).rejects.toThrow(REFUSAL);
      await markTested(school.id);
      await service.updateSettings(school.id, patch({ onlineEnabled: true }), SEED_ADMIN_USER_ID);
      expect((await stored(school.id)).onlineEnabled).toBe(true);
    });

    it('a credential or environment change clears lastTestOkAt and switches online off', async () => {
      for (const change of [{ appKey: 'NEW-KEY' }, { environment: 'PRODUCTION' }]) {
        const school = await createSchool();
        await service.updateSettings(school.id, patch({ bkash: CREDS }), SEED_ADMIN_USER_ID);
        await markTested(school.id);
        await service.updateSettings(school.id, patch({ onlineEnabled: true }), SEED_ADMIN_USER_ID);
        await service.updateSettings(school.id, patch({ bkash: change }), SEED_ADMIN_USER_ID);
        const p = await stored(school.id);
        expect(p.bkash.lastTestOkAt).toBeUndefined();
        expect(p.onlineEnabled).toBe(false);
      }
    });

    it('nulling a credential while online forces online off; turning online off is always allowed', async () => {
      const school = await createSchool();
      await service.updateSettings(school.id, patch({ bkash: CREDS }), SEED_ADMIN_USER_ID);
      await markTested(school.id);
      await service.updateSettings(school.id, patch({ onlineEnabled: true }), SEED_ADMIN_USER_ID);
      await service.updateSettings(
        school.id,
        patch({ bkash: { password: null } }),
        SEED_ADMIN_USER_ID,
      );
      const p = await stored(school.id);
      expect(p.bkash.password).toBeUndefined();
      expect(p.onlineEnabled).toBe(false);
      await service.updateSettings(school.id, patch({ onlineEnabled: false }), SEED_ADMIN_USER_ID);
    });

    it('enabling online in the same request as new credentials is refused', async () => {
      const school = await createSchool();
      await expect(
        service.updateSettings(
          school.id,
          patch({ onlineEnabled: true, bkash: CREDS }),
          SEED_ADMIN_USER_ID,
        ),
      ).rejects.toThrow(REFUSAL);
    });
  });

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

    describe('groups (stream) rename/remove covers class subjects and draft promotions', () => {
      async function seedGroup(name = 'Science') {
        const school = await createSchool();
        await schoolRepo.update(school.id, {
          settings: { version: 1, organisation: { shifts: [], versions: [], groups: [name] } },
        });
        const year = await dataSource.getRepository(AcademicYear).save({
          name: '2026-2027',
          start_date: '2026-01-01',
          end_date: '2026-12-31',
          tenant_id: school.id,
        });
        const klass = await dataSource
          .getRepository(Class)
          .save({ name: 'Class 9', academic_year_id: year.id, tenant_id: school.id });
        return { school, year, klass };
      }

      async function addClassSubject(
        s: { school: School; year: AcademicYear; klass: Class },
        group: string,
      ) {
        const subject = await dataSource.getRepository(Subject).save({
          name_en: 'Physics',
          code: `PHY-${randomUUID().slice(0, 6)}`,
          tenant_id: s.school.id,
        });
        return dataSource.getRepository(ClassSubject).save({
          class_id: s.klass.id,
          subject_id: subject.id,
          academic_year_id: s.year.id,
          group_name: group,
          tenant_id: s.school.id,
        });
      }

      async function addPromotionEntry(
        s: { school: School; year: AcademicYear; klass: Class },
        group: string,
        status: PromotionRunStatus,
      ) {
        const run = await dataSource.getRepository(PromotionRun).save({
          tenant_id: s.school.id,
          source_class_id: s.klass.id,
          source_academic_year_id: s.year.id,
          target_academic_year_id: s.year.id,
          exam_ids: [],
          algorithm: PlacementAlgorithm.BLOCK,
          status,
          refreshed_at: new Date(),
          created_by_user_id: SEED_ADMIN_USER_ID,
        } as any);
        return dataSource.getRepository(PromotionEntry).save({
          tenant_id: s.school.id,
          run_id: run.id,
          student_id: randomUUID(),
          source_enrollment_id: randomUUID(),
          passed_all: true,
          suggested_outcome: PromotionOutcome.PROMOTE,
          final_outcome: PromotionOutcome.PROMOTE,
          group_name: group,
        } as any);
      }

      const renamePatch = () =>
        plainToInstance(TenantSettingsDto, {
          version: 1,
          organisation: { shifts: [], versions: [], groups: ['বিজ্ঞান'] },
          organisationRenames: [{ list: 'groups', from: 'Science', to: 'বিজ্ঞান' }],
        });
      const removePatch = () =>
        plainToInstance(TenantSettingsDto, {
          version: 1,
          organisation: { shifts: [], versions: [], groups: [] },
        });

      it('rename rewrites class_subjects and DRAFT entries, leaves COMMITTED history alone', async () => {
        const s = await seedGroup();
        const cs = await addClassSubject(s, 'Science');
        const draft = await addPromotionEntry(s, 'Science', PromotionRunStatus.DRAFT);
        const done = await addPromotionEntry(s, 'Science', PromotionRunStatus.COMMITTED);

        await service.updateSettings(s.school.id, renamePatch(), SEED_ADMIN_USER_ID);

        expect(
          (await dataSource.getRepository(ClassSubject).findOneByOrFail({ id: cs.id })).group_name,
        ).toBe('বিজ্ঞান');
        const entries = dataSource.getRepository(PromotionEntry);
        expect((await entries.findOneByOrFail({ id: draft.id })).group_name).toBe('বিজ্ঞান');
        expect((await entries.findOneByOrFail({ id: done.id })).group_name).toBe('Science');
      });

      it('removing a group used only by a class subject is refused (400, names the count)', async () => {
        const s = await seedGroup();
        await addClassSubject(s, 'Science');
        await expect(
          service.updateSettings(s.school.id, removePatch(), SEED_ADMIN_USER_ID),
        ).rejects.toMatchObject({ status: 400, message: expect.stringContaining('1 row(s)') });
      });

      it('removing a group used only by a DRAFT promotion entry is refused', async () => {
        const s = await seedGroup();
        await addPromotionEntry(s, 'Science', PromotionRunStatus.DRAFT);
        await expect(
          service.updateSettings(s.school.id, removePatch(), SEED_ADMIN_USER_ID),
        ).rejects.toMatchObject({ status: 400, message: expect.stringContaining('1 row(s)') });
      });

      it('a COMMITTED promotion entry does not block removal', async () => {
        const s = await seedGroup();
        await addPromotionEntry(s, 'Science', PromotionRunStatus.COMMITTED);
        await expect(
          service.updateSettings(s.school.id, removePatch(), SEED_ADMIN_USER_ID),
        ).resolves.toBeDefined();
      });

      it("rename in tenant A leaves tenant B's class_subjects with the same name untouched", async () => {
        const a = await seedGroup();
        const b = await seedGroup();
        const csB = await addClassSubject(b, 'Science');
        const peB = await addPromotionEntry(b, 'Science', PromotionRunStatus.DRAFT);

        await service.updateSettings(a.school.id, renamePatch(), SEED_ADMIN_USER_ID);

        expect(
          (await dataSource.getRepository(PromotionEntry).findOneByOrFail({ id: peB.id }))
            .group_name,
        ).toBe('Science');

        expect(
          (await dataSource.getRepository(ClassSubject).findOneByOrFail({ id: csB.id })).group_name,
        ).toBe('Science');
      });
    });
  });
});
