import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import { UserRole } from '@biddaloy/shared';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { UserService, TeacherService } from './users.service';
import { StaffProfilesService } from '../staff-profiles/staff-profiles.service';
import { AuditService } from '../audit/audit.service';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { School } from '../schools/entities/school.entity';
import { UserTenant } from '../auth/entities/user-tenant.entity';

/**
 * [13.2.1] Leave / remove / restore of a school membership (D16): the
 * `user_tenants` row is soft-deleted, a school always keeps one ADMIN, and a
 * former member comes back with the same row. Real Postgres; every test makes
 * its own school so nothing depends on seed data or on other tests.
 */
describe('UserService membership leave / remove / restore (integration)', () => {
  let service: UserService;
  let dataSource: DataSource;
  let userTenantRepo: Repository<UserTenant>;
  // Audit rows FK to users, so the acting admin must be a real user.
  let ADMIN_ACTOR: string;

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, [
      UserService,
      TeacherService,
      StaffProfilesService,
      AuditService,
    ]);
    service = module.get(UserService);
    dataSource = module.get(DataSource);
    userTenantRepo = module.get(getRepositoryToken(UserTenant));
    const [{ id }] = await dataSource.query(
      `INSERT INTO users (email, full_name, status, created_at, updated_at)
       VALUES ($1, 'Actor', 'ACTIVE', NOW(), NOW()) RETURNING id`,
      [`${randomUUID()}@example.com`],
    );
    ADMIN_ACTOR = id;
  }, 60000);

  // No row cleanup: audit_logs is append-only (a school with audit rows cannot be
  // deleted) and the test database is thrown away after the run.
  afterAll(async () => {
    await dataSource?.destroy();
  });

  async function newSchool(): Promise<string> {
    const id = randomUUID();
    const repo = dataSource.getRepository(School);
    await repo.save(
      repo.create({ id, name: `School ${id}`, slug: `s-${id}`, tenant_id: id } as School),
    );
    return id;
  }

  async function addMember(tenantId: string, role: UserRole) {
    const { user } = await service.create(
      { full_name: `M ${role}`, email: `${randomUUID()}@example.com`, role },
      tenantId,
    );
    return user.id;
  }

  it('removal keeps the row: absent from the default list, present under membership=former', async () => {
    const tenant = await newSchool();
    await addMember(tenant, UserRole.ADMIN);
    const teacherId = await addMember(tenant, UserRole.TEACHER);

    await service.remove(teacherId, tenant, ADMIN_ACTOR);

    const current = await service.findAll({ page: 1, limit: 50 } as never, tenant);
    expect(current.data.map((u) => u.id)).not.toContain(teacherId);

    const former = await service.findAll(
      { page: 1, limit: 50, membership: 'former' } as never,
      tenant,
    );
    expect(former.data.map((u) => u.id)).toEqual([teacherId]);
    // The row is soft-deleted, not gone.
    expect(former.data[0].user_tenants[0].deleted_at).not.toBeNull();
  });

  it('the former list is tenant-scoped', async () => {
    const tenantA = await newSchool();
    const tenantB = await newSchool();
    await addMember(tenantA, UserRole.ADMIN);
    const teacherId = await addMember(tenantA, UserRole.TEACHER);
    await service.remove(teacherId, tenantA, ADMIN_ACTOR);

    const other = await service.findAll(
      { page: 1, limit: 50, membership: 'former' } as never,
      tenantB,
    );
    expect(other.data).toEqual([]);
  });

  it('the only admin cannot leave: 409 LAST_ADMIN, membership untouched', async () => {
    const tenant = await newSchool();
    const adminId = await addMember(tenant, UserRole.ADMIN);

    const err = await service.leave(adminId, tenant).catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.getResponse().details.code).toBe('LAST_ADMIN');
    expect(await userTenantRepo.count({ where: { tenant_id: tenant, user_id: adminId } })).toBe(1);
  });

  it('the only admin cannot be removed by someone else: 409 LAST_ADMIN', async () => {
    const tenant = await newSchool();
    const adminId = await addMember(tenant, UserRole.ADMIN);

    await expect(service.remove(adminId, tenant, ADMIN_ACTOR)).rejects.toThrow(ConflictException);
    expect(await userTenantRepo.count({ where: { tenant_id: tenant, user_id: adminId } })).toBe(1);
  });

  it('an admin may leave when another admin remains', async () => {
    const tenant = await newSchool();
    const a1 = await addMember(tenant, UserRole.ADMIN);
    await addMember(tenant, UserRole.ADMIN);

    await service.leave(a1, tenant);

    expect(await userTenantRepo.count({ where: { tenant_id: tenant, role: UserRole.ADMIN } })).toBe(
      1,
    );
  });

  it('a PARENT cannot leave: 403 LEAVE_NOT_ALLOWED', async () => {
    const tenant = await newSchool();
    const parentId = await addMember(tenant, UserRole.PARENT);

    const err = await service.leave(parentId, tenant).catch((e) => e);
    expect(err).toBeInstanceOf(ForbiddenException);
    expect(err.getResponse().details.code).toBe('LEAVE_NOT_ALLOWED');
  });

  it('leave removes only that school: the membership in a second school is untouched', async () => {
    const tenantA = await newSchool();
    const tenantB = await newSchool();
    const teacherId = await addMember(tenantA, UserRole.TEACHER);
    await userTenantRepo.save(
      userTenantRepo.create({ user_id: teacherId, tenant_id: tenantB, role: UserRole.TEACHER }),
    );

    await service.leave(teacherId, tenantA);

    // Same query shape AuthService.fetchMembershipPayload runs for the token.
    const remaining = await userTenantRepo.find({ where: { user_id: teacherId } });
    expect(remaining.map((m) => m.tenant_id)).toEqual([tenantB]);
  });

  it('restore brings back the same row id; a second restore is 404', async () => {
    const tenant = await newSchool();
    await addMember(tenant, UserRole.ADMIN);
    const teacherId = await addMember(tenant, UserRole.TEACHER);
    const before = await userTenantRepo.findOneOrFail({
      where: { user_id: teacherId, tenant_id: tenant },
    });
    await service.remove(teacherId, tenant, ADMIN_ACTOR);

    await service.restore(teacherId, tenant, ADMIN_ACTOR);

    const after = await userTenantRepo.findOneOrFail({
      where: { user_id: teacherId, tenant_id: tenant },
    });
    expect(after.id).toBe(before.id);
    // Nothing is soft-deleted any more, so restoring again finds nothing.
    await expect(service.restore(teacherId, tenant, ADMIN_ACTOR)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('restore of a user removed from another tenant is 404', async () => {
    const tenantA = await newSchool();
    const tenantB = await newSchool();
    await addMember(tenantA, UserRole.ADMIN);
    const teacherId = await addMember(tenantA, UserRole.TEACHER);
    await service.remove(teacherId, tenantA, ADMIN_ACTOR);

    await expect(service.restore(teacherId, tenantB, ADMIN_ACTOR)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('leave and restore write Membership audit rows with the actor and tenant', async () => {
    const tenant = await newSchool();
    await addMember(tenant, UserRole.ADMIN);
    const teacherId = await addMember(tenant, UserRole.TEACHER);

    await service.leave(teacherId, tenant);
    await service.restore(teacherId, tenant, ADMIN_ACTOR);

    const rows = await dataSource.getRepository(AuditLog).find({
      where: { tenant_id: tenant, entity_type: 'Membership' },
      order: { created_at: 'ASC' },
    });
    expect(rows.map((r) => (r.new_values as { operation: string }).operation)).toEqual([
      'LEAVE',
      'RESTORE',
    ]);
    expect(rows[0].performed_by_user_id).toBe(teacherId);
    expect(rows[1].performed_by_user_id).toBe(ADMIN_ACTOR);
  });
});
