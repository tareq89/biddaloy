import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { AuditAction } from '@biddaloy/shared';
import { SmsCreditsService } from './sms-credits.service';

/**
 * [15.6.7/#550]. Proves the sign-routing (`units > 0` -> grant, else
 * adjust), the audit write's shape (entity School, action UPDATE,
 * metadata `{ units, reason }`), and that a 400 from `SmsCreditService`
 * (adjust beyond available) propagates unchanged rather than being
 * swallowed.
 */
describe('SmsCreditsService', () => {
  let smsCreditService: Record<string, ReturnType<typeof vi.fn>>;
  let auditService: Record<string, ReturnType<typeof vi.fn>>;
  let service: SmsCreditsService;

  const SCHOOL_ID = 'school-1';
  const ACTOR_ID = 'user-1';

  beforeEach(() => {
    smsCreditService = { grant: vi.fn(), adjust: vi.fn() };
    auditService = { record: vi.fn().mockResolvedValue(undefined) };
    service = new SmsCreditsService(smsCreditService as any, auditService as any);
  });

  it('routes positive units to grant()', async () => {
    smsCreditService.grant.mockResolvedValue({ available: 500, reserved: 0, applied: true });
    const dto = { units: 500, reason: 'Top-up for term', idempotency_key: 'key-1' };

    const result = await service.grantOrAdjust(SCHOOL_ID, dto, ACTOR_ID);

    expect(smsCreditService.grant).toHaveBeenCalledWith(SCHOOL_ID, 500, {
      reason: dto.reason,
      actorUserId: ACTOR_ID,
      idempotencyKey: dto.idempotency_key,
    });
    expect(smsCreditService.adjust).not.toHaveBeenCalled();
    expect(result).toEqual({ available: 500, reserved: 0 });
  });

  it('routes negative units to adjust()', async () => {
    smsCreditService.adjust.mockResolvedValue({ available: 80, reserved: 0, applied: true });
    const dto = { units: -20, reason: 'Correcting a double top-up', idempotency_key: 'key-2' };

    await service.grantOrAdjust(SCHOOL_ID, dto, ACTOR_ID);

    expect(smsCreditService.adjust).toHaveBeenCalledWith(SCHOOL_ID, -20, {
      reason: dto.reason,
      actorUserId: ACTOR_ID,
      idempotencyKey: dto.idempotency_key,
    });
    expect(smsCreditService.grant).not.toHaveBeenCalled();
  });

  it('writes a School/UPDATE audit record with { units, reason, idempotency_key, balance } metadata after a grant', async () => {
    smsCreditService.grant.mockResolvedValue({ available: 500, reserved: 0, applied: true });
    const dto = { units: 500, reason: 'Top-up for term', idempotency_key: 'key-1' };

    await service.grantOrAdjust(SCHOOL_ID, dto, ACTOR_ID);

    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.UPDATE,
        entity_type: 'School',
        entity_id: SCHOOL_ID,
        tenant_id: SCHOOL_ID,
        performed_by_user_id: ACTOR_ID,
        new_values: {
          units: 500,
          reason: dto.reason,
          idempotency_key: dto.idempotency_key,
          balance: { available: 500, reserved: 0 },
        },
      }),
    );
  });

  it('propagates a 400 from adjust() (beyond available) without writing an audit record', async () => {
    smsCreditService.adjust.mockRejectedValue(
      new BadRequestException('Adjustment would drive the SMS credit balance below zero.'),
    );
    const dto = { units: -1000, reason: 'Correcting an over-grant', idempotency_key: 'key-3' };

    await expect(service.grantOrAdjust(SCHOOL_ID, dto, ACTOR_ID)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(auditService.record).not.toHaveBeenCalled();
  });

  it('skips the audit record when the movement replays an already-applied idempotency_key', async () => {
    smsCreditService.grant.mockResolvedValue({ available: 500, reserved: 0, applied: false });
    const dto = { units: 500, reason: 'Top-up for term', idempotency_key: 'key-1' };

    const result = await service.grantOrAdjust(SCHOOL_ID, dto, ACTOR_ID);

    expect(auditService.record).not.toHaveBeenCalled();
    expect(result).toEqual({ available: 500, reserved: 0 });
  });
});
