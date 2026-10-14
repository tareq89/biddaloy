import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DataSource, Repository } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import type { TestingModule } from '@nestjs/testing';
import { CommunicationMedium } from '@biddaloy/shared';
import { School } from '../../../schools/entities/school.entity';
import { User } from '../../../users/entities/user.entity';
import { Guardian } from '../../../students/entities/guardian.entity';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { guardiansTab, type GuardianRow } from './guardians.tab';

/**
 * Integration tests for the `guardians` tab against a real Postgres database.
 *
 * The unit spec covers the pure mapping. What it cannot cover is the
 * sharpest edge in this tab: `guardians (tenant_id, user_id)` is unique per
 * school among live rows (D11), so `upsert` looks the holder up in this
 * school only, prefers a live holder, revives a soft-deleted one instead of
 * re-inserting, and never touches the same user's guardian in another school.
 */
describe('guardiansTab (integration)', () => {
  let module: TestingModule;
  let dataSource: DataSource;
  let schoolRepo: Repository<School>;
  let userRepo: Repository<User>;
  let guardianRepo: Repository<Guardian>;

  const TENANT_A = '11111111-1111-4111-8111-111111111111';
  const TENANT_B = '22222222-2222-4222-8222-222222222222';

  beforeAll(async () => {
    module = await createTestModule(ALL_ENTITIES, []);
    dataSource = module.get(DataSource);
    schoolRepo = module.get<Repository<School>>(getRepositoryToken(School));
    userRepo = module.get<Repository<User>>(getRepositoryToken(User));
    guardianRepo = module.get<Repository<Guardian>>(getRepositoryToken(Guardian));
  });

  afterAll(async () => {
    await module?.close();
  });

  const FIXTURE_EMAIL_DOMAINS = ['@guardians-a.test', '@guardians-b.test'];

  beforeEach(async () => {
    await guardianRepo
      .createQueryBuilder()
      .delete()
      .where('tenant_id IN (:...ids)', { ids: [TENANT_A, TENANT_B] })
      .execute();

    for (const domain of FIXTURE_EMAIL_DOMAINS) {
      await userRepo
        .createQueryBuilder()
        .delete()
        .where('email LIKE :d', { d: `%${domain}` })
        .execute();
    }

    await schoolRepo.delete({ id: TENANT_A });
    await schoolRepo.delete({ id: TENANT_B });

    await schoolRepo.save(
      schoolRepo.create({ id: TENANT_A, name: 'Tenant A School', slug: 'tenant-a-guardians' }),
    );
    await schoolRepo.save(
      schoolRepo.create({ id: TENANT_B, name: 'Tenant B School', slug: 'tenant-b-guardians' }),
    );
  });

  async function makeUser(overrides: Partial<User> = {}): Promise<User> {
    return userRepo.save(
      userRepo.create({
        email: null,
        phone: null,
        full_name: 'Fixture Guardian',
        password_hash: null,
        ...overrides,
      }),
    );
  }

  function rowFor(overrides: Partial<GuardianRow> = {}): GuardianRow {
    return {
      id: '00000000-0000-4000-8000-000000000000',
      user_id: null,
      full_name: 'Karim Uddin',
      relationship: 'Father',
      phone: '01712345678',
      email: null,
      alternate_phone: null,
      address: null,
      occupation: null,
      preferred_communication: CommunicationMedium.SMS,
      is_primary_contact: true,
      notifications_enabled: true,
      user_key: null,
      ...overrides,
    };
  }

  describe('upsert', () => {
    it('creates a new guardian, linked to a user', async () => {
      const user = await makeUser({ email: 'create@guardians-a.test' });
      const row = rowFor({ user_id: user.id, phone: '01711111111' });

      const created = await guardiansTab.upsert(row, null, TENANT_A, dataSource.manager);

      const saved = await guardianRepo.findOneByOrFail({ id: created.id });
      expect(saved.full_name).toBe('Karim Uddin');
      expect(saved.tenant_id).toBe(TENANT_A);
      expect(saved.user_id).toBe(user.id);
    });

    it('creates a new guardian with no linked user', async () => {
      const row = rowFor({ user_id: null, phone: '01722222222' });

      const created = await guardiansTab.upsert(row, null, TENANT_A, dataSource.manager);

      const saved = await guardianRepo.findOneByOrFail({ id: created.id });
      expect(saved.user_id).toBeNull();
      expect(saved.tenant_id).toBe(TENANT_A);
    });

    it('updates only occupation for a single changed field', async () => {
      const existing = await guardiansTab.upsert(
        rowFor({ phone: '01733333333', occupation: 'Old job' }),
        null,
        TENANT_A,
        dataSource.manager,
      );

      const updated = await guardiansTab.upsert(
        rowFor({ id: existing.id, phone: '01733333333', occupation: 'New job' }),
        existing,
        TENANT_A,
        dataSource.manager,
      );

      const saved = await guardianRepo.findOneByOrFail({ id: updated.id });
      expect(saved.occupation).toBe('New job');
      expect(saved.full_name).toBe('Karim Uddin');
      expect(saved.phone).toBe('01733333333');
    });

    it('revives a soft-deleted guardian holding the same user_id rather than inserting', async () => {
      const user = await makeUser({ email: 'revive@guardians-a.test' });
      const created = await guardiansTab.upsert(
        rowFor({ user_id: user.id, phone: '01744444444' }),
        null,
        TENANT_A,
        dataSource.manager,
      );
      const loaded = await guardianRepo.findOneByOrFail({ id: created.id });
      await guardiansTab.remove(loaded, dataSource.manager);

      const softDeleted = await guardianRepo.findOne({
        where: { id: created.id },
        withDeleted: true,
      });
      expect(softDeleted?.deleted_at).not.toBeNull();

      // Restore run again, with `existing: null` (as an importer would pass
      // for a row it doesn't already know about) — matched by user_id.
      const revived = await guardiansTab.upsert(
        rowFor({ user_id: user.id, phone: '01744444444', occupation: 'Revived job' }),
        null,
        TENANT_A,
        dataSource.manager,
      );

      expect(revived.id).toBe(created.id);
      const all = await guardianRepo.find({ where: { user_id: user.id }, withDeleted: true });
      expect(all).toHaveLength(1);
      const saved = await guardianRepo.findOneByOrFail({ id: revived.id });
      expect(saved.deleted_at).toBeNull();
      expect(saved.occupation).toBe('Revived job');
    });

    it('lets the same user hold a guardian row in each school (D11)', async () => {
      const user = await makeUser({ email: 'collide@guardians-a.test' });
      await guardiansTab.upsert(
        rowFor({ user_id: user.id, phone: '01755555555' }),
        null,
        TENANT_A,
        dataSource.manager,
      );

      await guardiansTab.upsert(
        rowFor({ user_id: user.id, phone: '01766666666', user_key: user.email }),
        null,
        TENANT_B,
        dataSource.manager,
      );

      // One row per school, neither re-tenanted.
      const rows = await guardianRepo.find({ where: { user_id: user.id } });
      expect(rows.map((r) => r.tenant_id).sort()).toEqual([TENANT_A, TENANT_B]);
    });

    it('prefers the live holder over a soft-deleted twin with the same user (no 23505)', async () => {
      const user = await makeUser({ email: 'twin@guardians-a.test' });
      const old = await guardiansTab.upsert(
        rowFor({ user_id: user.id, phone: '01700000001' }),
        null,
        TENANT_A,
        dataSource.manager,
      );
      await guardiansTab.remove(
        await guardianRepo.findOneByOrFail({ id: old.id }),
        dataSource.manager,
      );
      // The per-school key is partial on deleted_at, so a live twin can exist.
      const live = await guardianRepo.save(
        guardianRepo.create({
          tenant_id: TENANT_A,
          user_id: user.id,
          full_name: 'Live Twin',
          relationship: 'Father',
          phone: '01700000002',
        }),
      );

      const again = await guardiansTab.upsert(
        rowFor({ user_id: user.id, phone: '01700000002', occupation: 'Kept' }),
        null,
        TENANT_A,
        dataSource.manager,
      );

      expect(again.id).toBe(live.id);
      const stillDeleted = await guardianRepo.findOne({ where: { id: old.id }, withDeleted: true });
      expect(stillDeleted?.deleted_at).not.toBeNull();
    });

    it('refuses with a clear error when the user already holds a different live guardian', async () => {
      const user = await makeUser({ email: 'holder@guardians-a.test' });
      await guardiansTab.upsert(
        rowFor({ user_id: user.id, phone: '01700000003' }),
        null,
        TENANT_A,
        dataSource.manager,
      );
      const other = await guardiansTab.upsert(
        rowFor({ phone: '01700000004' }),
        null,
        TENANT_A,
        dataSource.manager,
      );

      await expect(
        guardiansTab.upsert(
          rowFor({ user_id: user.id, phone: '01700000004' }),
          other,
          TENANT_A,
          dataSource.manager,
        ),
      ).rejects.toThrow(/already belongs to a different guardian record/);
    });
  });

  describe('remove', () => {
    it('soft-deletes: deleted_at is set, and the row is absent from a default find', async () => {
      const created = await guardiansTab.upsert(
        rowFor({ phone: '01777777777' }),
        null,
        TENANT_A,
        dataSource.manager,
      );
      const loaded = await guardianRepo.findOneByOrFail({ id: created.id });

      await guardiansTab.remove(loaded, dataSource.manager);

      const defaultFind = await guardianRepo.findOne({ where: { id: created.id } });
      expect(defaultFind).toBeNull();

      const withDeleted = await guardianRepo.findOne({
        where: { id: created.id },
        withDeleted: true,
      });
      expect(withDeleted?.deleted_at).not.toBeNull();
    });
  });

  describe('load', () => {
    it('never returns a tenant B guardian when loading tenant A', async () => {
      const guardianA = await guardiansTab.upsert(
        rowFor({ phone: '01788888888' }),
        null,
        TENANT_A,
        dataSource.manager,
      );
      await guardiansTab.upsert(
        rowFor({ phone: '01799999999' }),
        null,
        TENANT_B,
        dataSource.manager,
      );

      const loaded = await guardiansTab.load(TENANT_A, dataSource.manager);

      expect(loaded.map((g) => g.id)).toEqual([guardianA.id]);
    });
  });
});
