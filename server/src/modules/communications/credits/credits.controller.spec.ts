import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Reflector } from '@nestjs/core';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { UserRole, Permission } from '@biddaloy/shared';
import { RolesGuard } from '../../auth/guards/context.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { CreditsController } from './credits.controller';
import { SmsCreditService } from './sms-credit.service';
import {
  SmsCreditLedgerKind,
  SmsCreditLedgerReferenceType,
} from './entities/sms-credit-ledger.entity';

/**
 * [15.6.7/#550] Unit tests for CreditsController — service delegation and
 * response shaping, plus guard behaviour for its single route. Matching
 * `CommunicationsController.spec.ts`'s convention: guard checks unit-test
 * the guard directly rather than booting the full Nest module.
 */
describe('CreditsController', () => {
  let controller: CreditsController;
  let service: Record<string, ReturnType<typeof vi.fn>>;

  const TENANT_A = { id: 'tenant-a', role: UserRole.ADMIN };

  beforeEach(() => {
    service = {
      getCreditsSummary: vi.fn(),
    };
    controller = new CreditsController(service as unknown as SmsCreditService);
  });

  describe('getSmsCredits', () => {
    it('returns PLATFORM metering with balance and mapped ledger, scoped to the caller tenant', async () => {
      service.getCreditsSummary.mockResolvedValue({
        metering: 'PLATFORM',
        available: 120,
        reserved: 5,
        ledger: {
          data: [
            {
              id: 'ledger-1',
              kind: SmsCreditLedgerKind.GRANT,
              units: 100,
              reference_type: SmsCreditLedgerReferenceType.MANUAL,
              reference_id: null,
              reason: 'Initial top-up',
              created_at: new Date('2026-01-01T00:00:00Z'),
              // Fields a real row also carries — must never leak into the DTO.
              tenant_id: 'tenant-a',
              idempotency_key: 'key-1',
              actor_user_id: 'user-1',
            },
          ],
          total: 1,
          page: 1,
          limit: 20,
          totalPages: 1,
        },
      });

      const result = await controller.getSmsCredits({ page: 1, limit: 20 }, TENANT_A);

      expect(service.getCreditsSummary).toHaveBeenCalledWith(TENANT_A.id, 1, 20);

      expect(result.metering).toBe('PLATFORM');
      expect(result.available).toBe(120);
      expect(result.reserved).toBe(5);
      expect(result.ledger).toEqual({
        data: [
          {
            id: 'ledger-1',
            kind: SmsCreditLedgerKind.GRANT,
            units: 100,
            reference_type: SmsCreditLedgerReferenceType.MANUAL,
            reference_id: null,
            reason: 'Initial top-up',
            created_at: new Date('2026-01-01T00:00:00Z'),
          },
        ],
        total: 1,
        page: 1,
        limit: 20,
        totalPages: 1,
      });
      // No recipient/message/idempotency/tenant fields on the ledger row.
      expect(result.ledger.data[0]).not.toHaveProperty('tenant_id');
      expect(result.ledger.data[0]).not.toHaveProperty('idempotency_key');
      expect(result.ledger.data[0]).not.toHaveProperty('actor_user_id');
    });

    it('returns OFF metering with an empty ledger', async () => {
      service.getCreditsSummary.mockResolvedValue({
        metering: 'OFF',
        available: 0,
        reserved: 0,
        ledger: { data: [], total: 0, page: 1, limit: 20, totalPages: 1 },
      });

      const result = await controller.getSmsCredits({ page: 1, limit: 20 }, TENANT_A);

      expect(result.metering).toBe('OFF');
      expect(result.available).toBe(0);
      expect(result.reserved).toBe(0);
      expect(result.ledger.data).toEqual([]);
      expect(result.ledger.total).toBe(0);
    });

    it('defaults page/limit when the query omits them', async () => {
      service.getCreditsSummary.mockResolvedValue({
        metering: 'OFF',
        available: 0,
        reserved: 0,
        ledger: { data: [], total: 0, page: 1, limit: 20, totalPages: 1 },
      });

      await controller.getSmsCredits({}, TENANT_A);

      expect(service.getCreditsSummary).toHaveBeenCalledWith(TENANT_A.id, 1, 20);
    });

    it("never asks the service for another tenant's ledger", async () => {
      const TENANT_B = { id: 'tenant-b', role: UserRole.ADMIN };
      service.getCreditsSummary.mockResolvedValue({
        metering: 'OFF',
        available: 0,
        reserved: 0,
        ledger: { data: [], total: 0, page: 1, limit: 20, totalPages: 1 },
      });

      await controller.getSmsCredits({}, TENANT_B);

      expect(service.getCreditsSummary).not.toHaveBeenCalledWith(
        TENANT_A.id,
        expect.anything(),
        expect.anything(),
      );
      expect(service.getCreditsSummary).toHaveBeenCalledWith(TENANT_B.id, 1, 20);
    });
  });

  describe('guards', () => {
    const rolesGuard = new RolesGuard(new Reflector());
    const permissionsGuard = new PermissionsGuard(new Reflector());
    const handler = CreditsController.prototype.getSmsCredits;

    function context(role: UserRole) {
      return {
        getHandler: () => handler,
        getClass: () => CreditsController,
        switchToHttp: () => ({
          getRequest: () => ({ currentTenant: { id: 'tenant-a', role } }),
        }),
      } as any;
    }

    it('allows ADMIN', () => {
      expect(rolesGuard.canActivate(context(UserRole.ADMIN))).toBe(true);
      expect(permissionsGuard.canActivate(context(UserRole.ADMIN))).toBe(true);
    });

    it('allows ACCOUNTANT', () => {
      expect(rolesGuard.canActivate(context(UserRole.ACCOUNTANT))).toBe(true);
      expect(permissionsGuard.canActivate(context(UserRole.ACCOUNTANT))).toBe(true);
    });

    it('denies TEACHER at the RolesGuard', () => {
      expect(() => rolesGuard.canActivate(context(UserRole.TEACHER))).toThrow(
        UnauthorizedException,
      );
    });

    it('would deny a role holding COMMUNICATION_LOG_READ but not COMMUNICATION_CREDIT_READ at the PermissionsGuard', () => {
      // TEACHER holds COMMUNICATION_LOG_READ but not COMMUNICATION_CREDIT_READ —
      // proves the two are genuinely separate permissions, not aliases.
      expect(() => permissionsGuard.canActivate(context(UserRole.TEACHER))).toThrow(
        ForbiddenException,
      );
    });
  });
});

// Sanity: Permission.COMMUNICATION_CREDIT_READ exists and is imported
// correctly by the controller (a typo here would otherwise only surface as
// a silent "always forbidden").
describe('Permission.COMMUNICATION_CREDIT_READ', () => {
  it('is defined', () => {
    expect(Permission.COMMUNICATION_CREDIT_READ).toBe('COMMUNICATION_CREDIT_READ');
  });
});
