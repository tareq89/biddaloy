import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Job } from 'bullmq';
import { InvitationBatchProcessor } from './invitation-batch.processor';
import type { InvitationBatchJobData } from './guardian-provisioning.service';

function fakeManagerQueryBuilder(result: { one?: unknown | null }) {
  const qb: any = {
    where: vi.fn().mockReturnThis(),
    andWhere: vi.fn().mockReturnThis(),
    getOne: vi.fn().mockResolvedValue(result.one ?? null),
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

    processor = new InvitationBatchProcessor(
      guardianRepo,
      userRepo,
      userTenantRepo,
      dataSource,
      authTokens,
      invitationService,
    );
  });

  it('does nothing when the guardian is not found (already deleted)', async () => {
    guardianRepo.findOne.mockResolvedValue(null);

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
});
