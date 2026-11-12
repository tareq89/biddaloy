import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { PlatformAccessGuard } from '../../platform-identity/platform-access.guard';
import { SchoolSmsCreditsController } from './sms-credits.controller';
import { SmsCreditsService } from './sms-credits.service';

/**
 * [15.6.7/#550]. Guard test mirrors `SchoolAdminsController.spec.ts`:
 * `PlatformAccessGuard` on the class is the whole gate for this route.
 */
describe('SchoolSmsCreditsController', () => {
  let controller: SchoolSmsCreditsController;
  let service: Record<string, ReturnType<typeof vi.fn>>;
  let smsCreditService: Record<string, ReturnType<typeof vi.fn>>;

  const USER = { sub: 'user-1', memberships: [] } as any;

  beforeEach(() => {
    service = { grantOrAdjust: vi.fn() };
    smsCreditService = { getCreditsSummary: vi.fn() };
    controller = new SchoolSmsCreditsController(
      service as unknown as SmsCreditsService,
      smsCreditService as any,
    );
  });

  describe('grantOrAdjust', () => {
    it('delegates to the service with schoolId, dto, and the actor user id', async () => {
      const dto = { units: 500, reason: 'Top-up', idempotency_key: 'key-1' };
      const expected = { available: 500, reserved: 0 };
      service.grantOrAdjust.mockResolvedValue(expected);

      const result = await controller.grantOrAdjust('school-1', dto, USER);

      expect(service.grantOrAdjust).toHaveBeenCalledWith('school-1', dto, USER.sub);
      expect(result).toEqual(expected);
    });
  });

  describe('getSmsCredits', () => {
    it('reads the given schoolId, not the caller tenant', async () => {
      const summary = {
        metering: 'PLATFORM' as const,
        available: 100,
        reserved: 20,
        ledger: { data: [], total: 0, page: 1, limit: 20, totalPages: 1 },
      };
      smsCreditService.getCreditsSummary.mockResolvedValue(summary);

      const result = await controller.getSmsCredits('school-2', {});

      expect(smsCreditService.getCreditsSummary).toHaveBeenCalledWith('school-2', 1, 20);
      expect(result).toEqual(summary);
    });
  });

  describe('guards — platform only', () => {
    it('is guarded by PlatformAccessGuard at class level', () => {
      expect(Reflect.getMetadata(GUARDS_METADATA, SchoolSmsCreditsController)).toContain(
        PlatformAccessGuard,
      );
    });
  });
});
