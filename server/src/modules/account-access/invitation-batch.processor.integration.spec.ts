import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { Job } from 'bullmq';
import { DataSource } from 'typeorm';
import { TestingModule } from '@nestjs/testing';
import { AuthTokenPurpose, UserRole, UserStatus } from '@biddaloy/shared';
import { createTestModule } from '@test/helpers/module.helper';
import { SEED_TENANT_ID } from '@test/constants';
import { ALL_ENTITIES } from '@test/all-entities';
import { InvitationBatchProcessor } from './invitation-batch.processor';
import type { InvitationBatchJobData } from './guardian-provisioning.service';
import { AuthToken } from './entities/auth-token.entity';
import { User } from '../users/entities/user.entity';
import { UserTenant } from '../auth/entities/user-tenant.entity';
import { Guardian } from '../students/entities/guardian.entity';
import { School } from '../schools/entities/school.entity';

const OTHER_TENANT = '00000000-0000-4000-8000-000000000098';

describe('InvitationBatchProcessor (integration)', () => {
  let module: TestingModule;
  let ds: DataSource;
  let processor: InvitationBatchProcessor;
  let issueAndSend: ReturnType<typeof vi.fn>;

  beforeAll(async () => {
    module = await createTestModule(ALL_ENTITIES, []);
    ds = module.get(DataSource);
    issueAndSend = vi.fn().mockResolvedValue(undefined);
    processor = new InvitationBatchProcessor(
      ds.getRepository(Guardian),
      ds.getRepository(User),
      ds.getRepository(UserTenant),
      ds,
      { latest: vi.fn().mockResolvedValue(null) } as any,
      { issueAndSend } as any,
    );
  });

  afterAll(async () => {
    await module.close();
  });

  beforeEach(async () => {
    issueAndSend.mockClear();
    await ds.query('DELETE FROM audit_logs');
    await ds.query('DELETE FROM auth_tokens');
    await ds.query('DELETE FROM guardians');
    await ds.query('DELETE FROM user_tenants');
    await ds.query('DELETE FROM users');
    await ds.query('DELETE FROM schools');
    const schools = ds.getRepository(School);
    for (const [id, slug] of [
      [SEED_TENANT_ID, 'batch-t'],
      [OTHER_TENANT, 'batch-other'],
    ]) {
      await schools.save(schools.create({ id, name: slug, slug, tenant_id: id }));
    }
  });

  const run = (guardianId: string) =>
    processor.process({
      data: {
        tenantId: SEED_TENANT_ID,
        guardianId,
        actorUserId: null,
        batchId: 'batch-1',
      } as unknown as InvitationBatchJobData,
    } as Job<InvitationBatchJobData>);

  async function makeUser(over: Partial<User>) {
    const repo = ds.getRepository(User);
    return repo.save(repo.create({ full_name: 'Existing', status: UserStatus.ACTIVE, ...over }));
  }

  async function makeGuardian(over: Partial<Guardian>) {
    const repo = ds.getRepository(Guardian);
    return repo.save(
      repo.create({
        full_name: 'Guardian',
        relationship: 'Father',
        tenant_id: SEED_TENANT_ID,
        ...over,
      }),
    );
  }

  const membership = (userId: string, tenantId = SEED_TENANT_ID) =>
    ds.getRepository(UserTenant).find({ where: { user_id: userId, tenant_id: tenantId } });

  it('PUB-01: an unverified email never links the guardian to its holder', async () => {
    // Registration stores the email unverified; only the phone is proven.
    const stranger = await makeUser({
      phone: '+8801700000001',
      phone_verified_at: new Date(),
      email: 'parent@example.com',
      email_verified_at: null,
    });
    const g = await makeGuardian({ email: 'parent@example.com' });

    await run(g.id);

    const after = await ds.getRepository(Guardian).findOneOrFail({ where: { id: g.id } });
    expect(after.user_id).not.toBe(stranger.id);
    expect(await membership(stranger.id)).toHaveLength(0);
    // The unverified holder owns the email, so nothing was created or sent either.
    expect(issueAndSend).not.toHaveBeenCalled();
  });

  it('a verified user with no membership here gets a join request, not a membership', async () => {
    const owner = await makeUser({ email: 'owner@example.com', email_verified_at: new Date() });
    await ds
      .getRepository(UserTenant)
      .save({ user_id: owner.id, tenant_id: OTHER_TENANT, role: UserRole.PARENT });
    const g = await makeGuardian({ email: 'owner@example.com' });

    await run(g.id);

    const after = await ds.getRepository(Guardian).findOneOrFail({ where: { id: g.id } });
    expect(after.user_id).toBeNull();
    expect(await membership(owner.id)).toHaveLength(0);
    const tokens = await ds.getRepository(AuthToken).find({
      where: { user_id: owner.id, purpose: AuthTokenPurpose.JOIN_SCHOOL },
    });
    expect(tokens).toHaveLength(1);
    expect(tokens[0].tenant_id).toBe(SEED_TENANT_ID);
    expect(tokens[0].metadata).toMatchObject({ role: UserRole.PARENT, guardian_id: g.id });
    expect(issueAndSend).not.toHaveBeenCalled();
  });

  // M2: guardians.user_id is globally UNIQUE. A parent linked to a guardian at another
  // school can never be linked to this one, so no request is filed (it could only fail).
  it('a verified parent already linked to a guardian at another school gets no request and no crash', async () => {
    const owner = await makeUser({ email: 'linked@example.com', email_verified_at: new Date() });
    await ds
      .getRepository(UserTenant)
      .save({ user_id: owner.id, tenant_id: OTHER_TENANT, role: UserRole.PARENT });
    await makeGuardian({ tenant_id: OTHER_TENANT, user_id: owner.id });
    const g = await makeGuardian({ email: 'linked@example.com' });

    await expect(run(g.id)).resolves.toBeUndefined();

    const tokens = await ds.getRepository(AuthToken).find({
      where: { user_id: owner.id, purpose: AuthTokenPurpose.JOIN_SCHOOL },
    });
    expect(tokens).toHaveLength(0);
    expect(await membership(owner.id)).toHaveLength(0);
    expect(issueAndSend).not.toHaveBeenCalled();
  });

  // M3: a guardian.user_id this school never vetted (e.g. set by a restored workbook)
  // must not make that account a member here; only its owner can say yes.
  it('a guardian linked to an account with no row in this school files a join request, never a membership', async () => {
    const stranger = await makeUser({ email: 'stranger@example.com', password_hash: null });
    await ds
      .getRepository(UserTenant)
      .save({ user_id: stranger.id, tenant_id: OTHER_TENANT, role: UserRole.TEACHER });
    const g = await makeGuardian({ email: 'guardian@example.com', user_id: stranger.id });

    await run(g.id);

    expect(await membership(stranger.id)).toHaveLength(0);
    const tokens = await ds.getRepository(AuthToken).find({
      where: { user_id: stranger.id, purpose: AuthTokenPurpose.JOIN_SCHOOL },
    });
    expect(tokens).toHaveLength(1);
    expect(issueAndSend).not.toHaveBeenCalled();
  });

  it('a TEACHER here who is linked as a guardian gets a PARENT membership too', async () => {
    const teacher = await makeUser({ email: 'teacher@example.com', password_hash: null });
    await ds
      .getRepository(UserTenant)
      .save({ user_id: teacher.id, tenant_id: SEED_TENANT_ID, role: UserRole.TEACHER });
    const g = await makeGuardian({ email: 'teacher@example.com', user_id: teacher.id });

    await run(g.id);

    const roles = (await membership(teacher.id)).map((r) => r.role).sort();
    expect(roles).toEqual([UserRole.PARENT, UserRole.TEACHER]);
  });

  it('an unverified holder of the guardian phone blocks creation without crashing', async () => {
    const holder = await makeUser({ phone: '+8801700000002', phone_verified_at: null });
    const g = await makeGuardian({ phone: '+8801700000002' });

    await expect(run(g.id)).resolves.toBeUndefined();

    const after = await ds.getRepository(Guardian).findOneOrFail({ where: { id: g.id } });
    expect(after.user_id).toBeNull();
    expect(await membership(holder.id)).toHaveLength(0);
    expect(issueAndSend).not.toHaveBeenCalled();
  });

  it('with no match at all it still creates a passwordless parent and sends the invite', async () => {
    const g = await makeGuardian({ email: 'fresh@example.com' });

    await run(g.id);

    const after = await ds.getRepository(Guardian).findOneOrFail({ where: { id: g.id } });
    expect(after.user_id).not.toBeNull();
    expect(await membership(after.user_id as string)).toHaveLength(1);
    expect(issueAndSend).toHaveBeenCalledTimes(1);
  });
});
