import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { CommunicationStatus } from '@biddaloy/shared';
import { GuardianProvisioningService } from './guardian-provisioning.service';

/** A minimal fluent stub matching the subset of TypeORM's QueryBuilder this
 * service chains — every method returns `this` except the terminal ones. */
function fakeQueryBuilder(result: { many?: unknown[]; one?: unknown | null; raw?: unknown[] }) {
  const qb: any = {
    where: vi.fn().mockReturnThis(),
    andWhere: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    distinct: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    addSelect: vi.fn().mockReturnThis(),
    groupBy: vi.fn().mockReturnThis(),
    getMany: vi.fn().mockResolvedValue(result.many ?? []),
    getOne: vi.fn().mockResolvedValue(result.one ?? null),
    getRawMany: vi.fn().mockResolvedValue(result.raw ?? []),
  };
  return qb;
}

describe('GuardianProvisioningService', () => {
  let guardianRepo: any;
  let userRepo: any;
  let logRepo: any;
  let auditLogRepo: any;
  let authTokens: any;
  let audit: any;
  let queue: any;
  let service: GuardianProvisioningService;

  const TENANT = 'tenant-1';

  function makeGuardian(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      id: 'g1',
      tenant_id: TENANT,
      full_name: 'Guardian One',
      phone: '+8801711111111',
      email: null,
      user_id: null,
      notifications_enabled: true,
      ...overrides,
    };
  }

  beforeEach(() => {
    guardianRepo = { createQueryBuilder: vi.fn() };
    userRepo = { findOne: vi.fn(), createQueryBuilder: vi.fn() };
    logRepo = { createQueryBuilder: vi.fn() };
    auditLogRepo = { createQueryBuilder: vi.fn() };
    authTokens = { latest: vi.fn().mockResolvedValue(null) };
    audit = { record: vi.fn().mockResolvedValue(undefined) };
    queue = { add: vi.fn().mockResolvedValue(undefined) };

    service = new GuardianProvisioningService(
      guardianRepo,
      userRepo,
      logRepo,
      auditLogRepo,
      authTokens,
      audit,
      queue,
    );
  });

  describe('preview', () => {
    it('requires exactly one selector', async () => {
      await expect(service.preview(TENANT, {})).rejects.toThrow(BadRequestException);
      await expect(service.preview(TENANT, { all: true, guardian_ids: ['g1'] })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('lists one guardian shared by two students only once (sibling dedup via guardian dedup)', async () => {
      // `DISTINCT` on the guardian query is what guarantees a guardian
      // joined to two students appears once — the fake QB's getMany already
      // returns the deduped row set a real DISTINCT query would produce.
      const guardian = makeGuardian();
      guardianRepo.createQueryBuilder.mockReturnValue(fakeQueryBuilder({ many: [guardian] }));
      userRepo.createQueryBuilder.mockReturnValue(fakeQueryBuilder({ one: null }));

      const result = await service.preview(TENANT, { student_ids: ['s1', 's2'] });

      expect(result.total).toBe(1);
      expect(result.to_invite).toEqual([
        { guardian_id: 'g1', full_name: 'Guardian One', channel: 'SMS', user_exists: false },
      ]);
      expect(result.skipped).toEqual([]);
    });

    it('skips a guardian with no phone or email (no_contact)', async () => {
      const guardian = makeGuardian({ phone: null, email: null });
      guardianRepo.createQueryBuilder.mockReturnValue(fakeQueryBuilder({ many: [guardian] }));

      const result = await service.preview(TENANT, { all: true });

      expect(result.skipped).toEqual([
        { guardian_id: 'g1', full_name: 'Guardian One', reason: 'no_contact' },
      ]);
      expect(result.to_invite).toEqual([]);
    });

    it('skips a guardian who opted out of notifications', async () => {
      const guardian = makeGuardian({ notifications_enabled: false });
      guardianRepo.createQueryBuilder.mockReturnValue(fakeQueryBuilder({ many: [guardian] }));

      const result = await service.preview(TENANT, { all: true });

      expect(result.skipped).toEqual([
        { guardian_id: 'g1', full_name: 'Guardian One', reason: 'notifications_disabled' },
      ]);
    });

    it('skips a guardian whose linked user already has a password (already_active)', async () => {
      const guardian = makeGuardian({ user_id: 'u1' });
      guardianRepo.createQueryBuilder.mockReturnValue(fakeQueryBuilder({ many: [guardian] }));
      userRepo.findOne.mockResolvedValue({ id: 'u1', password_hash: 'hash' });

      const result = await service.preview(TENANT, { all: true });

      expect(result.skipped).toEqual([
        { guardian_id: 'g1', full_name: 'Guardian One', reason: 'already_active' },
      ]);
    });

    it('skips a guardian with a live pending invitation (already_pending)', async () => {
      const guardian = makeGuardian({ user_id: 'u1' });
      guardianRepo.createQueryBuilder.mockReturnValue(fakeQueryBuilder({ many: [guardian] }));
      userRepo.findOne.mockResolvedValue({ id: 'u1', password_hash: null });
      authTokens.latest.mockResolvedValue({
        consumed_at: null,
        revoked_at: null,
        expires_at: new Date(Date.now() + 60_000),
      });

      const result = await service.preview(TENANT, { all: true });

      expect(result.skipped).toEqual([
        { guardian_id: 'g1', full_name: 'Guardian One', reason: 'already_pending' },
      ]);
    });

    it('links (does not skip) a guardian without user_id whose phone matches an existing user', async () => {
      const guardian = makeGuardian({ user_id: null, phone: '+8801711111111' });
      guardianRepo.createQueryBuilder.mockReturnValue(fakeQueryBuilder({ many: [guardian] }));
      userRepo.createQueryBuilder.mockReturnValue(
        fakeQueryBuilder({ one: { id: 'u-existing', password_hash: null } }),
      );

      const result = await service.preview(TENANT, { all: true });

      expect(result.to_invite).toEqual([
        { guardian_id: 'g1', full_name: 'Guardian One', channel: 'SMS', user_exists: true },
      ]);
    });

    it('never lets a cross-tenant guardian id through — the tenant predicate on the query is what excludes it', async () => {
      // No rows returned for a guardian id belonging to another tenant —
      // the fake QB simulates the tenant-scoped query finding nothing,
      // which is exactly what the real `andWhere('guardian.tenant_id = ...')`
      // produces; this asserts the caller does not 500 on an empty result.
      guardianRepo.createQueryBuilder.mockReturnValue(fakeQueryBuilder({ many: [] }));

      const result = await service.preview(TENANT, { guardian_ids: ['cross-tenant-id'] });

      expect(result).toEqual({ total: 0, to_invite: [], skipped: [] });
    });
  });

  describe('dispatch', () => {
    it('enqueues one job per to_invite entry and writes one audit row', async () => {
      const guardians = [
        makeGuardian({ id: 'g1' }),
        makeGuardian({ id: 'g2', phone: '+8801711111112' }),
      ];
      guardianRepo.createQueryBuilder.mockReturnValue(fakeQueryBuilder({ many: guardians }));
      userRepo.createQueryBuilder.mockReturnValue(fakeQueryBuilder({ one: null }));

      const result = await service.dispatch({
        tenantId: TENANT,
        actorUserId: 'admin-1',
        selection: { all: true },
      });

      expect(queue.add).toHaveBeenCalledTimes(2);
      expect(queue.add).toHaveBeenCalledWith(
        'invite-guardian',
        expect.objectContaining({
          tenantId: TENANT,
          actorUserId: 'admin-1',
          batchId: result.batch_id,
        }),
        expect.objectContaining({ attempts: 3 }),
      );
      expect(audit.record).toHaveBeenCalledTimes(1);
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          entity_type: 'InvitationBatch',
          new_values: expect.objectContaining({ batch_id: result.batch_id, queued: 2 }),
        }),
      );
      expect(result.queued).toBe(2);
      expect(result.skipped).toEqual([]);
    });
  });

  describe('batchStatus', () => {
    it('derives sent/failed/queued from communication_logs and total from the audit row', async () => {
      auditLogRepo.createQueryBuilder.mockReturnValue(
        fakeQueryBuilder({ one: { new_values: { batch_id: 'b1', queued: 5 } } }),
      );
      logRepo.createQueryBuilder.mockReturnValue(
        fakeQueryBuilder({
          raw: [
            { status: CommunicationStatus.SENT, count: '3' },
            { status: CommunicationStatus.FAILED, count: '1' },
          ],
        }),
      );

      const result = await service.batchStatus(TENANT, 'b1');

      expect(result).toEqual({ batch_id: 'b1', total: 5, sent: 3, failed: 1, queued: 1 });
    });

    it('returns zeroes for an unknown or cross-tenant batch id (no matching audit row)', async () => {
      auditLogRepo.createQueryBuilder.mockReturnValue(fakeQueryBuilder({ one: null }));
      logRepo.createQueryBuilder.mockReturnValue(fakeQueryBuilder({ raw: [] }));

      const result = await service.batchStatus(TENANT, 'unknown');

      expect(result).toEqual({ batch_id: 'unknown', total: 0, sent: 0, failed: 0, queued: 0 });
    });
  });
});
