import { describe, it, expect, vi } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { FeeStatus } from '@biddaloy/shared';
import { FinesService } from './fines.service';

// Builds a FinesService whose bill lookup returns one fake bill.
function build(bill: Record<string, unknown>) {
  const qb: any = {};
  for (const m of ['innerJoinAndSelect', 'where', 'andWhere', 'setLock']) {
    qb[m] = vi.fn(() => qb);
  }
  qb.getOne = vi.fn(async () => bill);
  const update = vi.fn(async () => undefined);
  const manager: any = { getRepository: vi.fn(() => ({ createQueryBuilder: () => qb, update })) };
  const studentFeeRepo: any = { manager: { transaction: async (fn: any) => fn(manager) } };
  const approvalService: any = { consume: vi.fn(async () => ({ approverId: 'u2' })) };
  const auditService: any = { recordApproved: vi.fn(async () => undefined) };
  const service = new FinesService(
    studentFeeRepo,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    approvalService,
    auditService,
  );
  return { service, update, approvalService, auditService };
}

const bill = (status: FeeStatus) => ({
  id: 'b1',
  status,
  total_amount: 100,
  discount_amount: 0,
  paid_amount: 0,
  one_off_discount_amount: 0,
  fee_structure: { fee_type: 'FINE' },
});
const waive = (s: FinesService) => s.waiveBill('b1', { reason: 'r' } as any, 't1', 'u1', {} as any);

describe('FinesService.waiveBill status check (#3001)', () => {
  it.each([FeeStatus.WAIVED, FeeStatus.PAID, FeeStatus.ADVANCE])(
    'refuses a %s bill that still shows a balance, spending nothing',
    async (status) => {
      const t = build(bill(status));
      await expect(waive(t.service)).rejects.toBeInstanceOf(ConflictException);
      // The approval token must survive a refused waive.
      expect(t.approvalService.consume).not.toHaveBeenCalled();
      expect(t.update).not.toHaveBeenCalled();
      expect(t.auditService.recordApproved).not.toHaveBeenCalled();
    },
  );

  it('uses one fixed text that echoes nothing (Rule 23)', async () => {
    const t = build(bill(FeeStatus.WAIVED));
    await expect(waive(t.service)).rejects.toMatchObject({
      response: {
        message: 'This fee has no outstanding balance',
        details: { code: 'FINE_WAIVE_NOTHING_OUTSTANDING' },
      },
    });
  });

  it('still waives an OVERDUE bill', async () => {
    const t = build(bill(FeeStatus.OVERDUE));
    await expect(waive(t.service)).resolves.toMatchObject({ amount: 100, status: 'WAIVED' });
  });
});
