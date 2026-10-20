import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DelayedError, type Job } from 'bullmq';
import { InvitationBatchProcessor } from './invitation-batch.processor';
import { UserTenant } from '../auth/entities/user-tenant.entity';
import { reviveMembership } from '../users/users.service';
import { insertJoinRequest } from './school-invite.service';
import type { InvitationBatchJobData } from './guardian-provisioning.service';

vi.mock('../users/users.service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../users/users.service')>()),
  reviveMembership: vi.fn(async () => 1),
}));

vi.mock('./school-invite.service', () => ({
  insertJoinRequest: vi.fn(async () => ({})),
  guardianLinkedElsewhere: vi.fn(async () => false),
}));

function fakeManagerQueryBuilder(result: { one?: unknown | null }) {
  const qb: any = {
    where: vi.fn().mockReturnThis(),
    andWhere: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    getOne: vi.fn().mockResolvedValue(result.one ?? null),
    getMany: vi.fn().mockResolvedValue(result.one ? [result.one] : []),
  };
  return qb;
}

describe('InvitationBatchProcessor', () => {
  let guardianRepo: any;
  let userRepo: any;
  let userTenantRepo: any;
  let dataSource: any;
  let authTokens: any;
  let invitationService: any;
  let tenantStatus: any;
  let audit: any;
  let processor: InvitationBatchProcessor;

  const TENANT = 'tenant-1';
  const BATCH = 'batch-1';

  function job(overrides: Partial<InvitationBatchJobData> = {}): Job<InvitationBatchJobData> {
    return {
      data: {
        tenantId: TENANT,
        guardianId: 'g1',
        actorUserId: 'admin-1',
        batchId: BATCH,
        ...overrides,
      },
    } as Job<InvitationBatchJobData>;
  }

  beforeEach(() => {
    guardianRepo = { findOne: vi.fn() };
    userRepo = { findOne: vi.fn() };
    userTenantRepo = { findOne: vi.fn() };
    authTokens = { latest: vi.fn().mockResolvedValue(null) };
    invitationService = { issueAndSend: vi.fn().mockResolvedValue({ status: 'SENT' }) };

    // Each test that reaches `ensureUser` overrides this with a manager
    // stub of its own shape; the "guardian not found" test never calls it.
    dataSource = { transaction: vi.fn() };
    tenantStatus = {
      isRestoring: vi.fn().mockResolvedValue(false),
      isActive: vi.fn().mockResolvedValue(true),
    };

    audit = { record: vi.fn().mockResolvedValue(undefined) };
    processor = new InvitationBatchProcessor(
      guardianRepo,
      userRepo,
      userTenantRepo,
      dataSource,
      authTokens,
      invitationService,
      tenantStatus,
      audit,
    );
  });

  describe('onFailed', () => {
    const failedJob = (attemptsMade: number) =>
      ({ ...job(), attemptsMade, opts: { attempts: 3 } }) as unknown as Job<InvitationBatchJobData>;

    it('records an error skip on the final attempt', async () => {
      await processor.onFailed(failedJob(3), new Error('boom'));
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          entity_type: 'InvitationBatch',
          new_values: { batch_id: BATCH, guardian_id: 'g1', skipped: 'error' },
        }),
      );
    });

    it('records nothing on a non-final attempt', async () => {
      await processor.onFailed(failedJob(2), new Error('boom'));
      expect(audit.record).not.toHaveBeenCalled();
    });
  });

  // [68.1.fix] A restore rewrites users/guardians/user_tenants: writing now would be lost.
  it('[GAP-08] job for a SUSPENDED tenant issues no token and sends nothing', async () => {
    tenantStatus.isActive.mockResolvedValue(false);

    await processor.process(job());

    expect(tenantStatus.isActive).toHaveBeenCalledWith(TENANT);
    expect(guardianRepo.findOne).not.toHaveBeenCalled();
    expect(dataSource.transaction).not.toHaveBeenCalled();
    expect(invitationService.issueAndSend).not.toHaveBeenCalled();
  });

  it('parks the job (moveToDelayed + DelayedError) while the school is being restored, writing nothing', async () => {
    tenantStatus.isRestoring.mockResolvedValue(true);
    const moveToDelayed = vi.fn().mockResolvedValue(undefined);
    const parked = { ...job(), moveToDelayed } as unknown as Job<InvitationBatchJobData>;

    await expect(processor.process(parked, 'lock-token')).rejects.toBeInstanceOf(DelayedError);

    expect(tenantStatus.isRestoring).toHaveBeenCalledWith(TENANT, { failClosed: true });
    expect(moveToDelayed).toHaveBeenCalledWith(expect.any(Number), 'lock-token');
    expect(moveToDelayed.mock.calls[0][0]).toBeGreaterThan(Date.now());
    expect(guardianRepo.findOne).not.toHaveBeenCalled();
    expect(dataSource.transaction).not.toHaveBeenCalled();
    expect(invitationService.issueAndSend).not.toHaveBeenCalled();
  });

  it('does nothing when the guardian is not found (already deleted)', async () => {
    guardianRepo.findOne.mockResolvedValue(null);

    await processor.process(job());

    expect(dataSource.transaction).not.toHaveBeenCalled();
    expect(invitationService.issueAndSend).not.toHaveBeenCalled();
  });

  it('skips sending when the guardian opted out of notifications since preview', async () => {
    guardianRepo.findOne.mockResolvedValue({
      id: 'g1',
      tenant_id: TENANT,
      user_id: 'u1',
      notifications_enabled: false,
    });

    await processor.process(job());

    expect(dataSource.transaction).not.toHaveBeenCalled();
    expect(invitationService.issueAndSend).not.toHaveBeenCalled();
  });

  it('skips sending when the ensured user already has a password (activated since preview)', async () => {
    guardianRepo.findOne.mockResolvedValue({ id: 'g1', tenant_id: TENANT, user_id: 'u1' });
    dataSource.transaction = vi.fn(async (cb: (manager: any) => Promise<unknown>) => {
      const activatedUser = { id: 'u1', password_hash: 'hash' };
      const manager = {
        getRepository: () => ({
          findOne: vi.fn().mockResolvedValue(activatedUser),
          createQueryBuilder: () => fakeManagerQueryBuilder({ one: activatedUser }),
          update: vi.fn(),
          save: vi.fn(),
        }),
      };
      return cb(manager);
    });

    await processor.process(job());

    expect(invitationService.issueAndSend).not.toHaveBeenCalled();
  });

  it('is idempotent: does not re-issue when a live token from the same batch already exists', async () => {
    guardianRepo.findOne.mockResolvedValue({ id: 'g1', tenant_id: TENANT, user_id: 'u1' });
    const passwordlessUser = { id: 'u1', password_hash: null };
    dataSource.transaction = vi.fn(async (cb: (manager: any) => Promise<unknown>) => {
      const manager = {
        getRepository: () => ({
          findOne: vi.fn().mockResolvedValue(passwordlessUser),
          createQueryBuilder: () => fakeManagerQueryBuilder({ one: passwordlessUser }),
          update: vi.fn(),
          save: vi.fn(),
        }),
      };
      return cb(manager);
    });
    authTokens.latest.mockResolvedValue({
      consumed_at: null,
      revoked_at: null,
      expires_at: new Date(Date.now() + 60_000),
      metadata: { batch_id: BATCH },
    });

    await processor.process(job());

    expect(invitationService.issueAndSend).not.toHaveBeenCalled();
  });

  it('issues and sends when no live token from this batch exists yet', async () => {
    guardianRepo.findOne.mockResolvedValue({ id: 'g1', tenant_id: TENANT, user_id: 'u1' });
    const passwordlessUser = { id: 'u1', password_hash: null };
    dataSource.transaction = vi.fn(async (cb: (manager: any) => Promise<unknown>) => {
      const manager = {
        getRepository: () => ({
          findOne: vi.fn().mockResolvedValue(passwordlessUser),
          createQueryBuilder: () => fakeManagerQueryBuilder({ one: passwordlessUser }),
          update: vi.fn(),
          save: vi.fn(),
        }),
      };
      return cb(manager);
    });
    authTokens.latest.mockResolvedValue(null);

    await processor.process(job());

    expect(invitationService.issueAndSend).toHaveBeenCalledWith({
      userId: 'u1',
      tenantId: TENANT,
      actorUserId: 'admin-1',
      metadata: { batch_id: BATCH },
    });
  });

  it('[13.2.1] restores a former PARENT membership instead of inserting a duplicate', async () => {
    guardianRepo.findOne.mockResolvedValue({ id: 'g1', tenant_id: TENANT, user_id: 'u1' });
    const passwordlessUser = { id: 'u1', password_hash: null };
    const membershipRepo = {
      // Has belonged here (any row, withDeleted), has no live PARENT row, but a
      // soft-deleted PARENT row exists.
      findOne: vi
        .fn()
        .mockResolvedValueOnce({ id: 'ut-old' })
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'ut-old' }),
      save: vi.fn(),
      create: vi.fn((v: unknown) => v),
    };
    let txManager: unknown;
    dataSource.transaction = vi.fn(async (cb: (manager: any) => Promise<unknown>) => {
      const manager = {
        getRepository: (entity: unknown) =>
          entity === UserTenant
            ? membershipRepo
            : {
                findOne: vi.fn().mockResolvedValue(passwordlessUser),
                createQueryBuilder: () => fakeManagerQueryBuilder({ one: passwordlessUser }),
                update: vi.fn(),
                save: vi.fn(),
              },
      };
      txManager = manager;
      return cb(manager);
    });

    await processor.process(job());

    // The unique index ignores soft-deletion, so an insert would fail with 23505.
    expect(reviveMembership).toHaveBeenCalledWith(txManager, 'ut-old');
    expect(membershipRepo.save).not.toHaveBeenCalled();
  });

  it('[68.1.2218] a verified user with no membership here gets a join request, no INVITE', async () => {
    guardianRepo.findOne.mockResolvedValue({
      id: 'g1',
      tenant_id: TENANT,
      user_id: null,
      email: 'owner@example.com',
    });
    const verifiedUser = { id: 'u9', password_hash: 'hash' };
    const userTenantStub = { findOne: vi.fn().mockResolvedValue(null), save: vi.fn() };
    let txManager: unknown;
    dataSource.transaction = vi.fn(async (cb: (manager: any) => Promise<unknown>) => {
      const manager = {
        getRepository: (entity: unknown) =>
          entity === UserTenant
            ? userTenantStub
            : {
                findOne: vi.fn(),
                createQueryBuilder: () => fakeManagerQueryBuilder({ one: verifiedUser }),
                update: vi.fn(),
                save: vi.fn(),
              },
      };
      txManager = manager;
      return cb(manager);
    });

    await processor.process(job());

    expect(insertJoinRequest).toHaveBeenCalledWith(txManager, {
      userId: 'u9',
      tenantId: TENANT,
      role: 'PARENT',
      guardianId: 'g1',
      createdByUserId: 'admin-1',
    });
    expect(userTenantStub.save).not.toHaveBeenCalled();
    expect(invitationService.issueAndSend).not.toHaveBeenCalled();
  });
});
