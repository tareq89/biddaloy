import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { randomUUID } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
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
import { usersTab } from '../workbook/tabs/people/users.tab';

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

  it('restore brings back the same row id; a second restore is 409 ALREADY_MEMBER', async () => {
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
    // The member is active again, so restoring again is refused.
    await expect(service.restore(teacherId, tenant, ADMIN_ACTOR)).rejects.toThrow(
      ConflictException,
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

  it('two admins leaving at once: exactly one succeeds, one 409 LAST_ADMIN, one admin remains', async () => {
    const tenant = await newSchool();
    const a1 = await addMember(tenant, UserRole.ADMIN);
    const a2 = await addMember(tenant, UserRole.ADMIN);

    // Hold each transaction open after the check (the audit write comes after the
    // soft delete) so the two overlap. Without the row lock both count 2 admins
    // and both leave.
    const audit = (service as unknown as { audit: AuditService }).audit;
    const realRecord = audit.record.bind(audit);
    const spy = vi.spyOn(audit, 'record').mockImplementation(async (...args) => {
      await new Promise((r) => setTimeout(r, 300));
      return realRecord(...args);
    });
    const results = await Promise.allSettled([
      service.leave(a1, tenant),
      service.leave(a2, tenant),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBeInstanceOf(ConflictException);
    expect(rejected[0].reason.getResponse().details.code).toBe('LAST_ADMIN');
    expect(await userTenantRepo.count({ where: { tenant_id: tenant, role: UserRole.ADMIN } })).toBe(
      1,
    );
  });

  it('leave ends only staff roles: a TEACHER who is also a PARENT keeps the PARENT row', async () => {
    const tenant = await newSchool();
    const id = await addMember(tenant, UserRole.TEACHER);
    await userTenantRepo.save(
      userTenantRepo.create({ user_id: id, tenant_id: tenant, role: UserRole.PARENT }),
    );

    await service.leave(id, tenant);

    const left = await userTenantRepo.find({ where: { user_id: id, tenant_id: tenant } });
    expect(left.map((r) => r.role)).toEqual([UserRole.PARENT]);
  });

  it('a user with an active row and an older soft-deleted row is not "former", and cannot be restored (409 ALREADY_MEMBER)', async () => {
    const tenant = await newSchool();
    await addMember(tenant, UserRole.ADMIN);
    const id = await addMember(tenant, UserRole.TEACHER);
    await service.leave(id, tenant);
    await userTenantRepo.save(
      userTenantRepo.create({ user_id: id, tenant_id: tenant, role: UserRole.OFFICE_STAFF }),
    );

    const former = await service.findAll(
      { page: 1, limit: 50, membership: 'former' } as never,
      tenant,
    );
    expect(former.data.map((u) => u.id)).not.toContain(id);
    const err = await service.restore(id, tenant, ADMIN_ACTOR).catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.getResponse().details.code).toBe('ALREADY_MEMBER');
  });

  it('restore brings back only the latest removal: a role ended earlier (workbook role swap) stays ended', async () => {
    const tenant = await newSchool();
    await addMember(tenant, UserRole.ADMIN);
    const id = await addMember(tenant, UserRole.TEACHER);
    // An earlier workbook role swap (ADMIN -> TEACHER) left the ADMIN row soft-deleted.
    await userTenantRepo.save(
      userTenantRepo.create({ user_id: id, tenant_id: tenant, role: UserRole.ADMIN }),
    );
    await dataSource.query(
      `UPDATE user_tenants SET deleted_at = NOW() - interval '1 day'
        WHERE user_id = $1 AND tenant_id = $2 AND role = 'ADMIN'`,
      [id, tenant],
    );

    await service.remove(id, tenant, ADMIN_ACTOR);
    await service.restore(id, tenant, ADMIN_ACTOR);

    const active = await userTenantRepo.find({ where: { user_id: id, tenant_id: tenant } });
    expect(active.map((r) => r.role)).toEqual([UserRole.TEACHER]);
  });

  it('a teacher-parent who left is listed as former and can be restored; the PARENT row is untouched', async () => {
    const tenant = await newSchool();
    await addMember(tenant, UserRole.ADMIN);
    const id = await addMember(tenant, UserRole.TEACHER);
    const parentRow = await userTenantRepo.save(
      userTenantRepo.create({ user_id: id, tenant_id: tenant, role: UserRole.PARENT }),
    );

    await service.leave(id, tenant);

    const former = await service.findAll(
      { page: 1, limit: 50, membership: 'former' } as never,
      tenant,
    );
    expect(former.data.map((u) => u.id)).toEqual([id]);
    expect(former.data[0].user_tenants.map((ut) => ut.role)).toEqual([UserRole.TEACHER]);

    await service.restore(id, tenant, ADMIN_ACTOR);

    const rows = await userTenantRepo.find({ where: { user_id: id, tenant_id: tenant } });
    expect(rows.map((r) => r.role).sort()).toEqual([UserRole.PARENT, UserRole.TEACHER].sort());
    const parentAfter = rows.find((r) => r.role === UserRole.PARENT)!;
    expect(parentAfter.id).toBe(parentRow.id);
    expect(parentAfter.updated_at).toEqual(parentRow.updated_at);
  });

  it('only usable admins count: with the other admins deactivated or deleted, the last one cannot leave', async () => {
    const tenant = await newSchool();
    const a1 = await addMember(tenant, UserRole.ADMIN);
    const inactive = await addMember(tenant, UserRole.ADMIN);
    const deleted = await addMember(tenant, UserRole.ADMIN);
    await dataSource.query(`UPDATE users SET status = 'INACTIVE' WHERE id = $1`, [inactive]);
    await dataSource.query('UPDATE users SET deleted_at = NOW() WHERE id = $1', [deleted]);

    const err = await service.leave(a1, tenant).catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.getResponse().details.code).toBe('LAST_ADMIN');
  });

  it('a removed user with two roles appears once in the former list', async () => {
    const tenant = await newSchool();
    await addMember(tenant, UserRole.ADMIN);
    const id = await addMember(tenant, UserRole.TEACHER);
    await userTenantRepo.save(
      userTenantRepo.create({ user_id: id, tenant_id: tenant, role: UserRole.OFFICE_STAFF }),
    );
    await service.remove(id, tenant, ADMIN_ACTOR);

    const former = await service.findAll(
      { page: 1, limit: 50, membership: 'former' } as never,
      tenant,
    );
    expect(former.data.map((u) => u.id)).toEqual([id]);
    expect(former.total).toBe(1);
  });

  it('restore of a user whose account is soft-deleted is 404', async () => {
    const tenant = await newSchool();
    await addMember(tenant, UserRole.ADMIN);
    const id = await addMember(tenant, UserRole.TEACHER);
    await service.leave(id, tenant);
    await dataSource.query('UPDATE users SET deleted_at = NOW() WHERE id = $1', [id]);

    await expect(service.restore(id, tenant, ADMIN_ACTOR)).rejects.toThrow(NotFoundException);
  });

  it('[r2-m1] a workbook role swap that revives an old row is not a departure: not former, not restorable', async () => {
    const tenant = await newSchool();
    await addMember(tenant, UserRole.ADMIN);
    const email = `${randomUUID()}@example.com`;
    const { user } = await service.create(
      { full_name: 'Swap', email, role: UserRole.ADMIN },
      tenant,
    );
    // An old PARENT row, ended long ago.
    await userTenantRepo.save(
      userTenantRepo.create({ user_id: user.id, tenant_id: tenant, role: UserRole.PARENT }),
    );
    await dataSource.query(
      `UPDATE user_tenants SET deleted_at = NOW() - interval '1 day'
        WHERE user_id = $1 AND tenant_id = $2 AND role = 'PARENT'`,
      [user.id, tenant],
    );

    // The workbook says PARENT: PARENT is revived, ADMIN is swapped out.
    const row = { id: user.id, email, phone: null, full_name: 'Swap', role: UserRole.PARENT };
    await usersTab.upsert(row, null, tenant, dataSource.manager);

    const former = await service.findAll(
      { page: 1, limit: 50, membership: 'former' } as never,
      tenant,
    );
    expect(former.data.map((u) => u.id)).not.toContain(user.id);
    await expect(service.restore(user.id, tenant, ADMIN_ACTOR)).rejects.toThrow(NotFoundException);
    const active = await userTenantRepo.find({ where: { user_id: user.id, tenant_id: tenant } });
    expect(active.map((r) => r.role)).toEqual([UserRole.PARENT]);
  });

  it('[r2-m1] a row revived by a workbook swap counts again when it is later really removed', async () => {
    const tenant = await newSchool();
    await addMember(tenant, UserRole.ADMIN);
    const email = `${randomUUID()}@example.com`;
    const { user } = await service.create(
      { full_name: 'Back', email, role: UserRole.TEACHER },
      tenant,
    );
    const base = { id: user.id, email, phone: null, full_name: 'Back' };
    // TEACHER -> OFFICE_STAFF -> TEACHER: the second swap revives the swapped-out TEACHER row.
    await usersTab.upsert(
      { ...base, role: UserRole.OFFICE_STAFF },
      null,
      tenant,
      dataSource.manager,
    );
    await usersTab.upsert({ ...base, role: UserRole.TEACHER }, null, tenant, dataSource.manager);

    await service.remove(user.id, tenant, ADMIN_ACTOR);

    const former = await service.findAll(
      { page: 1, limit: 50, membership: 'former' } as never,
      tenant,
    );
    expect(former.data.map((u) => u.id)).toEqual([user.id]);
    expect(former.data[0].user_tenants.map((ut) => ut.role)).toEqual([UserRole.TEACHER]);
  });

  it('[1658 m6] restore of one role refuses a user who already holds another staff role (409)', async () => {
    const tenant = await newSchool();
    await addMember(tenant, UserRole.ADMIN);
    const id = await addMember(tenant, UserRole.ACCOUNTANT);
    await userTenantRepo.save(
      userTenantRepo.create({ user_id: id, tenant_id: tenant, role: UserRole.TEACHER }),
    );
    await dataSource.query(
      `UPDATE user_tenants SET deleted_at = NOW() WHERE user_id = $1 AND tenant_id = $2 AND role = 'TEACHER'`,
      [id, tenant],
    );

    const err = await service.restore(id, tenant, ADMIN_ACTOR, UserRole.TEACHER).catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.getResponse().details.code).toBe('ALREADY_MEMBER');
  });

  it('[r2-n1] a concurrent double remove ends the membership once: one 404, one audit row', async () => {
    const tenant = await newSchool();
    await addMember(tenant, UserRole.ADMIN);
    const teacherId = await addMember(tenant, UserRole.TEACHER);

    const audit = (service as unknown as { audit: AuditService }).audit;
    // Prototype, not `audit.record`: the earlier test leaves its spy in place.
    const realRecord = AuditService.prototype.record.bind(audit);
    const spy = vi.spyOn(audit, 'record').mockImplementation(async (...args) => {
      await new Promise((r) => setTimeout(r, 300));
      return realRecord(...args);
    });
    const results = await Promise.allSettled([
      service.remove(teacherId, tenant, ADMIN_ACTOR),
      service.remove(teacherId, tenant, ADMIN_ACTOR),
    ]);
    spy.mockRestore();

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    expect(rejected[0]?.reason).toBeInstanceOf(NotFoundException);
    const audits = await dataSource.getRepository(AuditLog).count({
      where: { tenant_id: tenant, entity_type: 'Membership' },
    });
    expect(audits).toBe(1);
  }, 20000);

  it('creating a user with a weak password is 400 PASSWORD_TOO_WEAK', async () => {
    const tenant = await newSchool();
    const err = await service
      .create(
        {
          full_name: 'Weak',
          email: `${randomUUID()}@example.com`,
          password: 'pw',
          role: UserRole.TEACHER,
        },
        tenant,
      )
      .catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.getResponse().details.code).toBe('PASSWORD_TOO_WEAK');
  });
});
