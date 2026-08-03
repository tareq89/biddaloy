import { describe, it, expect, vi } from 'vitest';
import { AuditService } from './audit.service';
import { AuditAction } from '@beton-boi/shared';

function fakeRepo() {
  return {
    create: vi.fn((v) => v),
    save: vi.fn(async (v) => ({ id: 'log-1', ...v })),
  };
}

describe('AuditService', () => {
  describe('record without a manager (non-transactional, fail-open)', () => {
    it('saves via its own repository', async () => {
      const repo = fakeRepo();
      const service = new AuditService(repo as any);

      await service.record({
        action: AuditAction.LOGIN,
        entity_type: 'User',
        entity_id: 'user-1',
        tenant_id: 'tenant-1',
        performed_by_user_id: 'user-1',
      });

      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.LOGIN, entity_id: 'user-1', tenant_id: 'tenant-1' }),
      );
    });

    it('redacts old_values/new_values before saving', async () => {
      const repo = fakeRepo();
      const service = new AuditService(repo as any);

      await service.record({
        action: AuditAction.FEE_STRUCTURE_CHANGE,
        entity_type: 'FeeStructure',
        entity_id: 'fs-1',
        tenant_id: 'tenant-1',
        performed_by_user_id: 'user-1',
        old_values: { amount: 100 },
        new_values: { amount: 200, token: 'abc' },
      });

      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          old_values: { amount: 100 },
          new_values: { amount: 200, token: '[REDACTED]' },
        }),
      );
    });

    // Ancillary write to an action that's already succeeded (or already
    // decided to fail for its own reasons) — a DB hiccup here must not
    // turn that outcome into a 500. Matches auth.service.ts's pre-existing
    // writeAuditLog behavior, now centralized here.
    it('swallows a save failure rather than throwing', async () => {
      const repo = fakeRepo();
      repo.save.mockRejectedValue(new Error('db unavailable'));
      const service = new AuditService(repo as any);

      await expect(
        service.record({
          action: AuditAction.LOGIN_FAILED,
          entity_type: 'User',
          entity_id: null,
          tenant_id: null,
          performed_by_user_id: null,
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe('record with a manager (transactional)', () => {
    it('saves via the manager-scoped repository, not its own', async () => {
      const repo = fakeRepo();
      const managerRepo = fakeRepo();
      const manager = { getRepository: vi.fn(() => managerRepo) };
      const service = new AuditService(repo as any);

      await service.record(
        {
          action: AuditAction.PAYMENT_RECEIVED,
          entity_type: 'Payment',
          entity_id: 'pay-1',
          tenant_id: 'tenant-1',
          performed_by_user_id: 'user-1',
        },
        manager as any,
      );

      expect(managerRepo.save).toHaveBeenCalled();
      expect(repo.save).not.toHaveBeenCalled();
    });

    // The opposite of the non-transactional case: a payment/invoice audit
    // write is part of the record of truth for that transaction, so a
    // failure here must roll back with it, not be silently swallowed.
    it('propagates a save failure so the caller transaction rolls back', async () => {
      const repo = fakeRepo();
      const managerRepo = fakeRepo();
      managerRepo.save.mockRejectedValue(new Error('db unavailable'));
      const manager = { getRepository: vi.fn(() => managerRepo) };
      const service = new AuditService(repo as any);

      await expect(
        service.record(
          {
            action: AuditAction.PAYMENT_RECEIVED,
            entity_type: 'Payment',
            entity_id: 'pay-1',
            tenant_id: 'tenant-1',
            performed_by_user_id: 'user-1',
          },
          manager as any,
        ),
      ).rejects.toThrow('db unavailable');
    });
  });

  describe('findAll', () => {
    it('scopes the query to the given tenant and applies filters', async () => {
      const qb: any = {
        where: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        take: vi.fn().mockReturnThis(),
        getManyAndCount: vi.fn().mockResolvedValue([[{ id: 'log-1' }], 1]),
      };
      const repo = { createQueryBuilder: vi.fn(() => qb) };
      const service = new AuditService(repo as any);

      const result = await service.findAll(
        { action: AuditAction.LOGIN, entity_type: 'User', page: 2, limit: 5 } as any,
        'tenant-1',
      );

      expect(qb.where).toHaveBeenCalledWith('audit_log.tenant_id = :tenantId', { tenantId: 'tenant-1' });
      expect(qb.andWhere).toHaveBeenCalledWith('audit_log.action = :action', { action: AuditAction.LOGIN });
      expect(qb.andWhere).toHaveBeenCalledWith('audit_log.entity_type = :entityType', { entityType: 'User' });
      expect(qb.skip).toHaveBeenCalledWith(5);
      expect(qb.take).toHaveBeenCalledWith(5);
      expect(result).toEqual({ data: [{ id: 'log-1' }], total: 1, page: 2, limit: 5, totalPages: 1 });
    });
  });
});
