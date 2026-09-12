import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DataSource, Repository } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import type { TestingModule } from '@nestjs/testing';
import { UserRole } from '@biddaloy/shared';
import { School } from '../../../schools/entities/school.entity';
import { User } from '../../../users/entities/user.entity';
import { UserTenant } from '../../../auth/entities/user-tenant.entity';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { usersTab, type UserRow } from './users.tab';

/**
 * Integration tests for the `users` tab against a real Postgres database.
 *
 * The unit spec covers the pure mapping. What it cannot cover is the thing
 * that actually matters for this tab: that a `User` is a global identity
 * shared across tenants, and that a restore into one tenant never touches
 * another tenant's membership or another tenant's copy of a shared user's
 * identity.
 */
describe('usersTab (integration)', () => {
  let module: TestingModule;
  let dataSource: DataSource;
  let schoolRepo: Repository<School>;
  let userRepo: Repository<User>;
  let userTenantRepo: Repository<UserTenant>;

  const TENANT_A = '11111111-1111-4111-8111-111111111111';
  const TENANT_B = '22222222-2222-4222-8222-222222222222';

  beforeAll(async () => {
    module = await createTestModule(ALL_ENTITIES, []);
    dataSource = module.get(DataSource);
    schoolRepo = module.get<Repository<School>>(getRepositoryToken(School));
    userRepo = module.get<Repository<User>>(getRepositoryToken(User));
    userTenantRepo = module.get<Repository<UserTenant>>(getRepositoryToken(UserTenant));
  });

  afterAll(async () => {
    await module?.close();
  });

  // Every fixture in this file uses an email ending in one of these domains,
  // so cleanup can find and remove them without tracking ids across tests.
  const FIXTURE_EMAIL_DOMAINS = ['@tenant-a.test', '@tenant-b.test', '@both.test'];

  beforeEach(async () => {
    // FK order: memberships, then users, then the schools they belong to.
    await userTenantRepo
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
    await userRepo.delete({ phone: '01700000001' });
    await userRepo.delete({ phone: '01799999999' });

    await schoolRepo.delete({ id: TENANT_A });
    await schoolRepo.delete({ id: TENANT_B });

    await schoolRepo.save(
      schoolRepo.create({ id: TENANT_A, name: 'Tenant A School', slug: 'tenant-a-school' }),
    );
    await schoolRepo.save(
      schoolRepo.create({ id: TENANT_B, name: 'Tenant B School', slug: 'tenant-b-school' }),
    );
  });

  async function makeUser(overrides: Partial<User> = {}): Promise<User> {
    return userRepo.save(
      userRepo.create({
        email: null,
        phone: null,
        full_name: 'Fixture User',
        password_hash: null,
        ...overrides,
      }),
    );
  }

  async function makeMembership(
    userId: string,
    tenantId: string,
    role: UserRole,
  ): Promise<UserTenant> {
    return userTenantRepo.save(
      userTenantRepo.create({ user_id: userId, tenant_id: tenantId, role, metadata: null }),
    );
  }

  function rowFor(overrides: Partial<UserRow> = {}): UserRow {
    return {
      id: '00000000-0000-4000-8000-000000000000',
      email: 'fixture@tenant-a.test',
      phone: null,
      full_name: 'Fixture User',
      role: UserRole.TEACHER,
      ...overrides,
    };
  }

  describe('load', () => {
    it('returns only the addressed tenant members (tenant isolation)', async () => {
      const userA = await makeUser({ email: 'a@tenant-a.test', full_name: 'User A' });
      await makeMembership(userA.id, TENANT_A, UserRole.TEACHER);
      const userB = await makeUser({ email: 'b@tenant-b.test', full_name: 'User B' });
      await makeMembership(userB.id, TENANT_B, UserRole.TEACHER);

      const loaded = await usersTab.load(TENANT_A, dataSource.manager);

      expect(loaded.map((u) => u.id)).toEqual([userA.id]);
    });

    it('excludes a SUPER_ADMIN member entirely', async () => {
      const superAdmin = await makeUser({ email: 'super@tenant-a.test', full_name: 'Super Admin' });
      await makeMembership(superAdmin.id, TENANT_A, UserRole.SUPER_ADMIN);

      const loaded = await usersTab.load(TENANT_A, dataSource.manager);

      expect(loaded.map((u) => u.id)).not.toContain(superAdmin.id);
    });

    it('attaches only tenant A membership to a user who is a member of both tenants', async () => {
      const shared = await makeUser({ email: 'shared@both.test', full_name: 'Shared User' });
      await makeMembership(shared.id, TENANT_A, UserRole.TEACHER);
      await makeMembership(shared.id, TENANT_B, UserRole.ADMIN);

      const loaded = await usersTab.load(TENANT_A, dataSource.manager);
      const found = loaded.find((u) => u.id === shared.id);

      expect(found).toBeDefined();
      expect(found?.user_tenants).toHaveLength(1);
      expect(found?.user_tenants[0].tenant_id).toBe(TENANT_A);
    });
  });

  describe('upsert', () => {
    it('creates a new User with password_hash null and one membership for the tenant', async () => {
      const row = rowFor({ email: 'new@tenant-a.test', role: UserRole.TEACHER });

      const result = await usersTab.upsert(row, null, TENANT_A, dataSource.manager);

      expect(result.password_hash).toBeNull();
      const memberships = await userTenantRepo.find({ where: { user_id: result.id } });
      expect(memberships).toHaveLength(1);
      expect(memberships[0].tenant_id).toBe(TENANT_A);
      expect(memberships[0].role).toBe(UserRole.TEACHER);
    });

    it('updates only full_name for a single-tenant user', async () => {
      const user = await makeUser({
        email: 'single@tenant-a.test',
        phone: '01700000001',
        full_name: 'Old Name',
      });
      await makeMembership(user.id, TENANT_A, UserRole.TEACHER);

      const row = rowFor({
        email: 'single@tenant-a.test',
        phone: '01700000001',
        full_name: 'New Name',
        role: UserRole.TEACHER,
      });

      await usersTab.upsert(row, user, TENANT_A, dataSource.manager);

      const updated = await userRepo.findOneByOrFail({ id: user.id });
      expect(updated.full_name).toBe('New Name');
      expect(updated.email).toBe('single@tenant-a.test');
      expect(updated.phone).toBe('01700000001');
    });

    // Named cross-tenant test from the issue: a shared user's identity is
    // never rewritten by an import into a tenant that isn't the only one
    // they belong to.
    it('adds a membership for tenant A but leaves tenant B untouched and identity unchanged', async () => {
      const shared = await makeUser({
        email: 'shared@both.test',
        full_name: 'Original Name',
      });
      const membershipB = await makeMembership(shared.id, TENANT_B, UserRole.ADMIN);

      const row = rowFor({
        email: 'shared@both.test',
        full_name: 'Different Name From Workbook',
        role: UserRole.TEACHER,
      });

      await usersTab.upsert(row, null, TENANT_A, dataSource.manager);

      const updatedUser = await userRepo.findOneByOrFail({ id: shared.id });
      expect(updatedUser.full_name).toBe('Original Name');

      const membershipsA = await userTenantRepo.find({
        where: { user_id: shared.id, tenant_id: TENANT_A },
      });
      expect(membershipsA).toHaveLength(1);
      expect(membershipsA[0].role).toBe(UserRole.TEACHER);

      const stillB = await userTenantRepo.findOneByOrFail({ id: membershipB.id });
      expect(stillB.role).toBe(UserRole.ADMIN);
      expect(stillB.tenant_id).toBe(TENANT_B);
    });

    // Companion to the `remove()` provisioned-exemption test below: the
    // same tag must also protect the role, not just survival. A workbook
    // whose `users` sheet lists this admin's email at a lower role (or is
    // simply an untrusted/malicious upload) must not demote the school
    // owner out of ADMIN.
    it('never downgrades a membership tagged metadata.provisioned, even when the workbook row says otherwise', async () => {
      const admin = await makeUser({
        email: 'provisioned-admin@tenant-a.test',
        full_name: 'Provisioned Admin',
      });
      const membership = await userTenantRepo.save(
        userTenantRepo.create({
          user_id: admin.id,
          tenant_id: TENANT_A,
          role: UserRole.ADMIN,
          metadata: { provisioned: true },
        }),
      );

      // The uploaded workbook lists this same email at a lower role.
      const row = rowFor({
        email: 'provisioned-admin@tenant-a.test',
        full_name: 'Provisioned Admin',
        role: UserRole.TEACHER,
      });

      await usersTab.upsert(row, admin, TENANT_A, dataSource.manager);

      const stillAdmin = await userTenantRepo.findOneByOrFail({ id: membership.id });
      expect(stillAdmin.role).toBe(UserRole.ADMIN);

      const memberships = await userTenantRepo.find({
        where: { user_id: admin.id, tenant_id: TENANT_A },
      });
      expect(memberships).toHaveLength(1);
    });

    it('matches by phone when the row email is empty', async () => {
      const user = await makeUser({ email: null, phone: '01799999999', full_name: 'Phone User' });

      const row = rowFor({ email: null, phone: '01799999999', role: UserRole.TEACHER });

      const result = await usersTab.upsert(row, null, TENANT_A, dataSource.manager);

      expect(result.id).toBe(user.id);
    });

    it('is idempotent when run twice with the same row', async () => {
      const row = rowFor({ email: 'twice@tenant-a.test', role: UserRole.TEACHER });

      const first = await usersTab.upsert(row, null, TENANT_A, dataSource.manager);
      await usersTab.upsert(row, first, TENANT_A, dataSource.manager);

      const memberships = await userTenantRepo.find({ where: { user_id: first.id } });
      expect(memberships).toHaveLength(1);
    });

    it('updates the membership role in place rather than adding a second row', async () => {
      const user = await makeUser({ email: 'rerole@tenant-a.test', full_name: 'Rerole User' });
      await makeMembership(user.id, TENANT_A, UserRole.TEACHER);

      const row = rowFor({ email: 'rerole@tenant-a.test', role: UserRole.ADMIN });

      await usersTab.upsert(row, user, TENANT_A, dataSource.manager);

      const memberships = await userTenantRepo.find({
        where: { user_id: user.id, tenant_id: TENANT_A },
      });
      expect(memberships).toHaveLength(1);
      expect(memberships[0].role).toBe(UserRole.ADMIN);
    });
  });

  describe('remove', () => {
    it('deletes only tenant A membership; the User survives and tenant B membership survives', async () => {
      const shared = await makeUser({ email: 'remove@both.test', full_name: 'Remove Me' });
      await makeMembership(shared.id, TENANT_A, UserRole.TEACHER);
      const membershipB = await makeMembership(shared.id, TENANT_B, UserRole.ADMIN);

      const [loaded] = await usersTab.load(TENANT_A, dataSource.manager);
      await usersTab.remove(loaded, dataSource.manager);

      const survivingUser = await userRepo.findOneByOrFail({ id: shared.id });
      expect(survivingUser.deleted_at).toBeNull();

      const membershipsA = await userTenantRepo.find({
        where: { user_id: shared.id, tenant_id: TENANT_A },
      });
      expect(membershipsA).toHaveLength(0);

      const stillB = await userTenantRepo.findOneByOrFail({ id: membershipB.id });
      expect(stillB.tenant_id).toBe(TENANT_B);
    });

    // [item 4] Headline bug: create a school (ProvisioningService tags its
    // admin membership `metadata.provisioned`), then restore a workbook from
    // ANOTHER school — that workbook's users sheet only lists the source
    // school's users, so the new admin is legitimately absent from it.
    // `deleteByAbsence` must not read that absence as "remove this admin."
    it('never removes a membership tagged metadata.provisioned, even when absent from the workbook', async () => {
      const admin = await makeUser({ email: 'admin@tenant-a.test', full_name: 'New School Admin' });
      await userTenantRepo.save(
        userTenantRepo.create({
          user_id: admin.id,
          tenant_id: TENANT_A,
          role: UserRole.ADMIN,
          metadata: { provisioned: true },
        }),
      );

      const [loaded] = await usersTab.load(TENANT_A, dataSource.manager);
      await usersTab.remove(loaded, dataSource.manager);

      const stillThere = await userTenantRepo.find({
        where: { user_id: admin.id, tenant_id: TENANT_A },
      });
      expect(stillThere).toHaveLength(1);
    });
  });
});
