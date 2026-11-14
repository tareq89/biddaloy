import { describe, it, expect, vi } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { SmsBundlePaymentService } from './sms-bundle-payment.service';

function build(row: Record<string, unknown> | undefined, oversold = false) {
  const m = { query: vi.fn().mockResolvedValueOnce(row ? [row] : []) };
  const ds = { transaction: (fn: (x: unknown) => unknown) => fn(m) };
  const svc = new SmsBundlePaymentService(
    ds as never,
    { purchase: vi.fn() } as never,
    { isOversold: async () => oversold } as never,
    { emailReceipt: vi.fn() } as never,
    { get: async () => ({ rate_bp: null, label: 'VAT', registration: null }) } as never,
  );
  return { svc, m };
}

describe('SmsBundlePaymentService', () => {
  it('markPaid on an order that is not PENDING_PAYMENT changes nothing', async () => {
    for (const status of ['CANCELLED', 'PAID', 'ACTIVE']) {
      const { svc, m } = build({ status });
      expect(await svc.markPaid('o', { method: 'BKASH' as never })).toEqual({ applied: false });
      expect(m.query).toHaveBeenCalledTimes(1); // only the lock read
    }
  });

  it('markPaid on an unknown order is a 404', async () => {
    await expect(build(undefined).svc.markPaid('o', { method: 'BKASH' as never })).rejects.toThrow(
      NotFoundException,
    );
  });

  it('assertSalesOpen: 409 SMS_SALES_PAUSED only when oversold', async () => {
    await expect(build(undefined, false).svc.assertSalesOpen()).resolves.toBeUndefined();
    await expect(build(undefined, true).svc.assertSalesOpen()).rejects.toThrow(ConflictException);
  });
});
