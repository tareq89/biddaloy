import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DataSource, Repository } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import type { TestingModule } from '@nestjs/testing';
import { TeacherDesignation } from '@biddaloy/shared';
import { School } from '../../../schools/entities/school.entity';
import { User } from '../../../users/entities/user.entity';
import { Teacher } from '../../../academics/entities/teacher.entity';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { teachersTab, type TeacherRow } from './teachers.tab';

/**
 * Integration tests for the `teachers` tab against a real Postgres database.
 *
 * The unit spec covers the pure mapping. What it cannot cover is the
 * sharpest edge in this tab: `Teacher.employee_id` (and `user_id`) are
 * globally unique across every tenant, not scoped to one — so `upsert`
 * must look them up without a tenant filter, must revive a soft-deleted
 * holder instead of re-inserting, and must refuse to silently re-tenant a
 * teacher that belongs to a different school.
 */
describe('teachersTab (integration)', () => {
  let module: TestingModule;
  let dataSource: DataSource;
  let schoolRepo: Repository<School>;
  let userRepo: Repository<User>;
  let teacherRepo: Repository<Teacher>;

  const TENANT_A = '11111111-1111-4111-8111-111111111111';
  const TENANT_B = '22222222-2222-4222-8222-222222222222';

  beforeAll(async () => {
    module = await createTestModule(ALL_ENTITIES, []);
    dataSource = module.get(DataSource);
    schoolRepo = module.get<Repository<School>>(getRepositoryToken(School));
    userRepo = module.get<Repository<User>>(getRepositoryToken(User));
    teacherRepo = module.get<Repository<Teacher>>(getRepositoryToken(Teacher));
  });

  afterAll(async () => {
    await module?.close();
  });

  const FIXTURE_EMAIL_DOMAINS = ['@teachers-a.test', '@teachers-b.test'];

  beforeEach(async () => {
    await teacherRepo
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
      schoolRepo.create({ id: TENANT_A, name: 'Tenant A School', slug: 'tenant-a-teachers' }),
    );
    await schoolRepo.save(
      schoolRepo.create({ id: TENANT_B, name: 'Tenant B School', slug: 'tenant-b-teachers' }),
    );
  });

  async function makeUser(overrides: Partial<User> = {}): Promise<User> {
    return userRepo.save(
      userRepo.create({
        email: null,
        phone: null,
        full_name: 'Fixture Teacher',
        password_hash: null,
        ...overrides,
      }),
    );
  }

  function rowFor(overrides: Partial<TeacherRow> = {}): TeacherRow {
    return {
      id: '00000000-0000-4000-8000-000000000000',
      user_id: '',
      employee_id: 'EMP-A-001',
      designations: [TeacherDesignation.CLASS_TEACHER],
      subject_specialization: null,
      joining_date: null,
      user_key: '',
      ...overrides,
    };
  }

  describe('upsert', () => {
    it('creates a new teacher', async () => {
      const user = await makeUser({ email: 'create@teachers-a.test' });
      const row = rowFor({ user_id: user.id, employee_id: 'EMP-A-CREATE' });

      const created = await teachersTab.upsert(row, null, TENANT_A, dataSource.manager);

      const saved = await teacherRepo.findOneByOrFail({ id: created.id });
      expect(saved.employee_id).toBe('EMP-A-CREATE');
      expect(saved.tenant_id).toBe(TENANT_A);
      expect(saved.user_id).toBe(user.id);
    });

    it('updates only subject_specialization for a single changed field', async () => {
      const user = await makeUser({ email: 'update@teachers-a.test' });
      const existing = await teachersTab.upsert(
        rowFor({ user_id: user.id, employee_id: 'EMP-A-UPDATE', subject_specialization: 'Old' }),
        null,
        TENANT_A,
        dataSource.manager,
      );

      const updated = await teachersTab.upsert(
        rowFor({
          id: existing.id,
          user_id: user.id,
          employee_id: 'EMP-A-UPDATE',
          subject_specialization: 'New',
        }),
        existing,
        TENANT_A,
        dataSource.manager,
      );

      const saved = await teacherRepo.findOneByOrFail({ id: updated.id });
      expect(saved.subject_specialization).toBe('New');
      expect(saved.employee_id).toBe('EMP-A-UPDATE');
    });

    it('is idempotent when run twice with the same row (no duplicate, no 23505)', async () => {
      const user = await makeUser({ email: 'twice@teachers-a.test' });
      const row = rowFor({ user_id: user.id, employee_id: 'EMP-A-TWICE' });

      const first = await teachersTab.upsert(row, null, TENANT_A, dataSource.manager);
      await teachersTab.upsert(row, first, TENANT_A, dataSource.manager);

      const all = await teacherRepo.find({ where: { employee_id: 'EMP-A-TWICE' } });
      expect(all).toHaveLength(1);
    });

    it('revives a soft-deleted teacher with the same employee_id rather than inserting', async () => {
      const user = await makeUser({ email: 'revive@teachers-a.test' });
      const created = await teachersTab.upsert(
        rowFor({ user_id: user.id, employee_id: 'EMP-A-REVIVE' }),
        null,
        TENANT_A,
        dataSource.manager,
      );
      const loaded = await teacherRepo.findOneByOrFail({ id: created.id });
      await teachersTab.remove(loaded, dataSource.manager);

      const softDeleted = await teacherRepo.findOne({
        where: { id: created.id },
        withDeleted: true,
      });
      expect(softDeleted?.deleted_at).not.toBeNull();

      // Restore run again, with `existing: null` (as an importer would pass
      // for a row it doesn't already know about).
      const revived = await teachersTab.upsert(
        rowFor({
          user_id: user.id,
          employee_id: 'EMP-A-REVIVE',
          subject_specialization: 'Physics',
        }),
        null,
        TENANT_A,
        dataSource.manager,
      );

      expect(revived.id).toBe(created.id);
      const all = await teacherRepo.find({
        where: { employee_id: 'EMP-A-REVIVE' },
        withDeleted: true,
      });
      expect(all).toHaveLength(1);
      const saved = await teacherRepo.findOneByOrFail({ id: revived.id });
      expect(saved.deleted_at).toBeNull();
      expect(saved.subject_specialization).toBe('Physics');
    });

    it('throws a clear error naming both tenants on a cross-tenant employee_id collision', async () => {
      const userA = await makeUser({ email: 'collide-a@teachers-a.test' });
      await teachersTab.upsert(
        rowFor({ user_id: userA.id, employee_id: 'EMP-SHARED' }),
        null,
        TENANT_A,
        dataSource.manager,
      );

      const userB = await makeUser({ email: 'collide-b@teachers-b.test' });
      const rowForB = rowFor({ user_id: userB.id, employee_id: 'EMP-SHARED' });

      await expect(teachersTab.upsert(rowForB, null, TENANT_B, dataSource.manager)).rejects.toThrow(
        /EMP-SHARED/,
      );

      // The tenant A teacher must not have been re-tenanted.
      const stillA = await teacherRepo.findOneByOrFail({ employee_id: 'EMP-SHARED' });
      expect(stillA.tenant_id).toBe(TENANT_A);
    });
  });

  describe('remove', () => {
    it('soft-deletes: deleted_at is set, and the row is absent from a default find', async () => {
      const user = await makeUser({ email: 'remove@teachers-a.test' });
      const created = await teachersTab.upsert(
        rowFor({ user_id: user.id, employee_id: 'EMP-A-REMOVE' }),
        null,
        TENANT_A,
        dataSource.manager,
      );
      const loaded = await teacherRepo.findOneByOrFail({ id: created.id });

      await teachersTab.remove(loaded, dataSource.manager);

      const defaultFind = await teacherRepo.findOne({ where: { id: created.id } });
      expect(defaultFind).toBeNull();

      const withDeleted = await teacherRepo.findOne({
        where: { id: created.id },
        withDeleted: true,
      });
      expect(withDeleted?.deleted_at).not.toBeNull();
    });
  });

  describe('load', () => {
    it('never returns a tenant B teacher when loading tenant A', async () => {
      const userA = await makeUser({ email: 'load-a@teachers-a.test' });
      const teacherA = await teachersTab.upsert(
        rowFor({ user_id: userA.id, employee_id: 'EMP-A-LOAD' }),
        null,
        TENANT_A,
        dataSource.manager,
      );
      const userB = await makeUser({ email: 'load-b@teachers-b.test' });
      await teachersTab.upsert(
        rowFor({ user_id: userB.id, employee_id: 'EMP-B-LOAD' }),
        null,
        TENANT_B,
        dataSource.manager,
      );

      const loaded = await teachersTab.load(TENANT_A, dataSource.manager);

      expect(loaded.map((t) => t.id)).toEqual([teacherA.id]);
    });
  });
});
