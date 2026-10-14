import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { TestingModule } from '@nestjs/testing';
import { AuditAction, AuthTokenPurpose, UserRole, UserStatus } from '@biddaloy/shared';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { createTestModule } from '@test/helpers/module.helper';
import { SEED_TENANT_ID } from '@test/constants';
import { ALL_ENTITIES } from '@test/all-entities';
import { StaffProfilesService } from '../staff-profiles/staff-profiles.service';
import { StaffProfile } from '../staff-profiles/entities/staff-profile.entity';
import { AuditService } from '../audit/audit.service';
import { AuthTokenService } from './auth-token.service';
import { insertJoinRequest, SchoolInviteService } from './school-invite.service';
import { AuthToken } from './entities/auth-token.entity';
import { User } from '../users/entities/user.entity';
import { UserTenant } from '../auth/entities/user-tenant.entity';
import { Guardian } from '../students/entities/guardian.entity';
import { School } from '../schools/entities/school.entity';

const TENANT_B = '00000000-0000-4000-8000-000000000097';
const CTX = { ip: null, userAgent: null };

describe('SchoolInviteService (integration)', () => {
  let module: TestingModule;
  let ds: DataSource;
  let service: SchoolInviteService;
  let user: User;

  beforeAll(async () => {
    module = await createTestModule(ALL_ENTITIES, [
      SchoolInviteService,
      AuthTokenService,
      AuditService,
      StaffProfilesService,
    ]);
    ds = module.get(DataSource);
    service = module.get(SchoolInviteService);
  });

  afterAll(async () => {
    await module.close();
  });

  beforeEach(async () => {
    await ds.query('DELETE FROM audit_logs');
    await ds.query('DELETE FROM auth_tokens');
    await ds.query('DELETE FROM staff_profiles');
    await ds.query('DELETE FROM guardians');
    await ds.query('DELETE FROM user_tenants');
    await ds.query('DELETE FROM users');
    await ds.query('DELETE FROM schools');
    const schools = ds.getRepository(School);
    for (const [id, slug] of [
      [SEED_TENANT_ID, 'invite-a'],
      [TENANT_B, 'invite-b'],
    ]) {
      await schools.save(schools.create({ id, name: slug, slug, tenant_id: id }));
    }
    const users = ds.getRepository(User);
    user = await users.save(
      users.create({ full_name: 'Owner', email: 'o@example.com', status: UserStatus.ACTIVE }),
    );
  });

  const request = (
    tenantId = SEED_TENANT_ID,
    extra: { guardianId?: string } = {},
    role = UserRole.PARENT,
  ) =>
    ds.transaction((m) =>
      insertJoinRequest(m, {
        userId: user.id,
        tenantId,
        role,
        createdByUserId: null,
        ...extra,
      }),
    );
  const memberships = (tenantId = SEED_TENANT_ID) =>
    ds.getRepository(UserTenant).find({ where: { user_id: user.id, tenant_id: tenantId } });

  it('accept creates the PARENT membership and links guardian.user_id', async () => {
    const g = await ds.getRepository(Guardian).save(
      ds.getRepository(Guardian).create({
        full_name: 'G',
        relationship: 'Mother',
        tenant_id: SEED_TENANT_ID,
      }),
    );
    const row = await request(SEED_TENANT_ID, { guardianId: g.id });
    expect(await memberships()).toHaveLength(0);

    await service.accept(user.id, row.id, CTX);

    const [ut] = await memberships();
    expect(ut.role).toBe(UserRole.PARENT);
    const linked = await ds.getRepository(Guardian).findOneOrFail({ where: { id: g.id } });
    expect(linked.user_id).toBe(user.id);
    // The request is spent: a second accept finds nothing live.
    await expect(service.accept(user.id, row.id, CTX)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('[68.2.02] accepting an ACCOUNTANT request creates the membership and this school staff profile', async () => {
    const row = await request(TENANT_B, {}, UserRole.ACCOUNTANT);
    expect(await memberships(TENANT_B)).toHaveLength(0);

    await service.accept(user.id, row.id, CTX);

    const [ut] = await memberships(TENANT_B);
    expect(ut.role).toBe(UserRole.ACCOUNTANT);
    const profiles = await ds.getRepository(StaffProfile).find({ where: { user_id: user.id } });
    expect(profiles.map((p) => p.tenant_id)).toEqual([TENANT_B]);
  });

  it('accept revives a soft-deleted membership instead of inserting (no 23505)', async () => {
    const utRepo = ds.getRepository(UserTenant);
    const old = await utRepo.save(
      utRepo.create({ user_id: user.id, tenant_id: SEED_TENANT_ID, role: UserRole.PARENT }),
    );
    await utRepo.softDelete({ id: old.id });
    const row = await request();

    await service.accept(user.id, row.id, CTX);

    const rows = await memberships();
    expect(rows.map((r) => r.id)).toEqual([old.id]);
  });

  it('accept of an expired, revoked or consumed request is 404', async () => {
    const tokens = ds.getRepository(AuthToken);
    const expired = await request();
    await tokens.update({ id: expired.id }, { expires_at: new Date(Date.now() - 1000) });
    await expect(service.accept(user.id, expired.id, CTX)).rejects.toBeInstanceOf(
      NotFoundException,
    );

    const revoked = await request();
    await tokens.update({ id: revoked.id }, { revoked_at: new Date() });
    await expect(service.accept(user.id, revoked.id, CTX)).rejects.toBeInstanceOf(
      NotFoundException,
    );

    const consumed = await request();
    await service.accept(user.id, consumed.id, CTX);
    await expect(service.accept(user.id, consumed.id, CTX)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("someone else's request is 404 and stays pending", async () => {
    const row = await request();
    const users = ds.getRepository(User);
    const other = await users.save(users.create({ full_name: 'X', email: 'x@example.com' }));

    await expect(service.accept(other.id, row.id, CTX)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.decline(other.id, row.id, CTX)).rejects.toBeInstanceOf(NotFoundException);
    expect(await service.listMine(user.id)).toHaveLength(1);
  });

  it('a second request for the same user and school revokes the first', async () => {
    const first = await request();
    const second = await request();

    const live = await service.listMine(user.id);
    expect(live.map((r) => r.id)).toEqual([second.id]);
    const old = await ds.getRepository(AuthToken).findOneOrFail({ where: { id: first.id } });
    expect(old.revoked_at).not.toBeNull();
  });

  it('a request for school A is untouched by a new request for school B', async () => {
    const a = await request(SEED_TENANT_ID);
    await request(TENANT_B);

    const live = await service.listMine(user.id);
    expect(live).toHaveLength(2);
    expect(live.find((r) => r.id === a.id)?.school_name).toBe('invite-a');
    const token = await ds.getRepository(AuthToken).findOneOrFail({ where: { id: a.id } });
    expect(token.purpose).toBe(AuthTokenPurpose.JOIN_SCHOOL);
    expect(token.revoked_at).toBeNull();
  });

  // [68.1.fix F3] Provisioning (ADMIN), guardian batch (PARENT) and restore
  // (any role) all file requests. One must not cancel another's.
  it('an ADMIN request for the same user and school leaves the PARENT request (and its guardian) live', async () => {
    const g = await makeGuardian();
    const parent = await request(SEED_TENANT_ID, { guardianId: g.id });
    const admin = await request(SEED_TENANT_ID, {}, UserRole.ADMIN);

    const live = await service.listMine(user.id);
    expect(live.map((r) => r.id).sort()).toEqual([parent.id, admin.id].sort());

    await service.accept(user.id, parent.id, CTX);
    const linked = await ds.getRepository(Guardian).findOneOrFail({ where: { id: g.id } });
    expect(linked.user_id).toBe(user.id);
  });

  const makeGuardian = (tenantId = SEED_TENANT_ID, over: Partial<Guardian> = {}) =>
    ds
      .getRepository(Guardian)
      .save(
        ds
          .getRepository(Guardian)
          .create({ full_name: 'G', relationship: 'Mother', tenant_id: tenantId, ...over }),
      );

  // [58.0.02] guardians (tenant_id, user_id) is unique PER SCHOOL: a parent already
  // linked at school B links to school A's guardian too (D11).
  it('a parent already linked to a guardian at another school is linked here as well', async () => {
    await makeGuardian(TENANT_B, { user_id: user.id });
    const gA = await makeGuardian();
    const row = await request(SEED_TENANT_ID, { guardianId: gA.id });

    await service.accept(user.id, row.id, CTX);

    expect(await memberships()).toHaveLength(1);
    const after = await ds.getRepository(Guardian).findOneOrFail({ where: { id: gA.id } });
    expect(after.user_id).toBe(user.id);
  });

  // Same school: a second guardian row for the same account would break the per-school
  // unique index, so accept says so (409), not 500.
  it('a parent already linked to another guardian of the same school gets a 409, no membership, and the request is retired', async () => {
    await makeGuardian(SEED_TENANT_ID, { user_id: user.id });
    const gA = await makeGuardian();
    const row = await request(SEED_TENANT_ID, { guardianId: gA.id });

    await expect(service.accept(user.id, row.id, CTX)).rejects.toBeInstanceOf(ConflictException);

    expect(await memberships()).toHaveLength(0);
    const after = await ds.getRepository(Guardian).findOneOrFail({ where: { id: gA.id } });
    expect(after.user_id).toBeNull();
    // Not stuck: the request is gone from the list, so the person is not asked again.
    expect(await service.listMine(user.id)).toHaveLength(0);
  });

  it('a link held by a soft-deleted guardian of the same school also blocks (restoring it would collide)', async () => {
    const old = await makeGuardian(SEED_TENANT_ID, { user_id: user.id });
    await ds.getRepository(Guardian).softDelete({ id: old.id });
    const gA = await makeGuardian();
    const row = await request(SEED_TENANT_ID, { guardianId: gA.id });

    await expect(service.accept(user.id, row.id, CTX)).rejects.toBeInstanceOf(ConflictException);
    expect(await memberships()).toHaveLength(0);
  });

  it('a guardian deleted since the request was filed gives a 409 and no membership', async () => {
    const g = await makeGuardian();
    const row = await request(SEED_TENANT_ID, { guardianId: g.id });
    await ds.getRepository(Guardian).softDelete({ id: g.id });

    await expect(service.accept(user.id, row.id, CTX)).rejects.toBeInstanceOf(ConflictException);
    expect(await memberships()).toHaveLength(0);
  });

  it('a guardian linked to someone else since the request was filed gives a 409', async () => {
    const users = ds.getRepository(User);
    const other = await users.save(users.create({ full_name: 'Y', email: 'y@example.com' }));
    const g = await makeGuardian(SEED_TENANT_ID, { user_id: other.id });
    const row = await request(SEED_TENANT_ID, { guardianId: g.id });

    await expect(service.accept(user.id, row.id, CTX)).rejects.toBeInstanceOf(ConflictException);
    expect(await memberships()).toHaveLength(0);
  });

  it('a person who is already a TEACHER here still gets the PARENT membership on accept', async () => {
    const utRepo = ds.getRepository(UserTenant);
    await utRepo.save(
      utRepo.create({ user_id: user.id, tenant_id: SEED_TENANT_ID, role: UserRole.TEACHER }),
    );
    const row = await request();

    await service.accept(user.id, row.id, CTX);

    const roles = (await memberships()).map((r) => r.role).sort();
    expect(roles).toEqual([UserRole.PARENT, UserRole.TEACHER]);
  });

  it('a request from a deleted school is not listed and cannot be accepted', async () => {
    const row = await request(TENANT_B);
    await ds.getRepository(School).softDelete({ id: TENANT_B });

    expect(await service.listMine(user.id)).toHaveLength(0);
    await expect(service.accept(user.id, row.id, CTX)).rejects.toBeInstanceOf(NotFoundException);
    expect(await memberships(TENANT_B)).toHaveLength(0);
  });

  it('every audit row of one request names the user and carries the request id', async () => {
    const row = await request();
    await service.decline(user.id, row.id, CTX);

    const audits = await ds.getRepository(AuditLog).find({ order: { created_at: 'ASC' } });
    expect(audits.map((a) => a.entity_id)).toEqual([user.id, user.id]);
    expect(audits.map((a) => a.new_values?.request_id)).toEqual([row.id, row.id]);
    // A decline retires a request; no membership ever existed to delete.
    expect(audits[1].action).toBe(AuditAction.INVITATION_REVOKED);
  });

  it('decline revokes the request and creates no membership', async () => {
    const row = await request();

    await service.decline(user.id, row.id, CTX);

    expect(await service.listMine(user.id)).toHaveLength(0);
    expect(await memberships()).toHaveLength(0);
  });
});
