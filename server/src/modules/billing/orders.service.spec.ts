import { describe, it, expect, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { PlatformPaymentMethod } from '@biddaloy/shared';
import { OrdersService } from './orders.service';

describe('OrdersService', () => {
  const build = (txQuery: ReturnType<typeof vi.fn>) => {
    const manager = { query: txQuery };
    const dataSource = {
      transaction: vi.fn((fn: (m: unknown) => unknown) => fn(manager)),
      query: vi.fn().mockResolvedValue([]),
    };
    const entitlement = { recompute: vi.fn(), afterCommit: vi.fn() };
    const receipts = { emailReceipt: vi.fn() };
    const vat = {
      get: vi.fn().mockResolvedValue({ rate_bp: null, label: 'VAT', registration: null }),
    };
    const plans = {
      priceFor: vi.fn().mockResolvedValue({ planId: 'p1', name: 'Std', unitPricePaisa: 1200 }),
    };
    const coupons = { preview: vi.fn(), redeemInTx: vi.fn() };
    const moneyNotices = { couponApplied: vi.fn() };
    return {
      service: new OrdersService(
        dataSource as never,
        entitlement as never,
        receipts as never,
        plans as never,
        coupons as never,
        vat as never,
        moneyNotices as never,
      ),
      plans,
      coupons,
      moneyNotices,
      receipts,
      entitlement,
      dataSource,
    };
  };

  it('markPaid applies once: payment inserted, recompute and post-commit hooks run', async () => {
    const q = vi
      .fn()
      .mockResolvedValueOnce([]) // school lock
      .mockResolvedValueOnce([{ school_id: 's1', seats: 5 }]) // the order
      .mockResolvedValueOnce([{ start: '2026-01-01' }]) // start date
      .mockResolvedValueOnce([[{ id: 'o1', school_id: 's1', amount_paisa: '5000' }], 1]) // UPDATE
      .mockResolvedValueOnce(undefined) // INSERT payment
      .mockResolvedValueOnce([{ name: 'S', address: null }]) // school for the snapshot
      .mockResolvedValueOnce(undefined) // receipt advisory lock
      .mockResolvedValueOnce([{ n: '7' }]) // next receipt serial
      .mockResolvedValueOnce(undefined); // UPDATE receipt_number
    const { service, entitlement, receipts } = build(q);
    expect(await service.markPaid('o1', { method: PlatformPaymentMethod.BKASH })).toEqual({
      applied: true,
    });
    // The 7th receipt of the year is numbered SMR-<year>-000007 and its email is queued.
    expect(q.mock.calls[8][1]).toEqual([
      'o1',
      expect.stringMatching(/^SMR-\d{4}-000007$/),
      expect.any(String),
    ]);
    expect(JSON.parse(q.mock.calls[8][1][2])).toEqual({ name: 'S', address: null, vat: null });
    expect(receipts.emailReceipt).toHaveBeenCalledWith('o1');
    expect(entitlement.recompute).toHaveBeenCalledWith('s1', expect.anything());
    expect(entitlement.afterCommit).toHaveBeenCalledWith('s1');
  });

  it('markPaid on an already-paid order does nothing (no payment, no recompute)', async () => {
    const q = vi
      .fn()
      .mockResolvedValueOnce([]) // school lock
      .mockResolvedValueOnce([{ school_id: 's1', seats: 5 }]) // the order exists
      .mockResolvedValueOnce([{ start: '2026-01-01' }]) // start date
      .mockResolvedValueOnce([[], 0]); // conditional UPDATE matched nothing (already PAID)
    const { service, entitlement, receipts } = build(q);
    expect(await service.markPaid('o1', { method: PlatformPaymentMethod.BKASH })).toEqual({
      applied: false,
    });
    // A replay sends no second receipt email.
    expect(receipts.emailReceipt).not.toHaveBeenCalled();
    expect(entitlement.recompute).not.toHaveBeenCalled();
    expect(entitlement.afterCommit).not.toHaveBeenCalled();
  });

  it('markPaid on an unknown order is a 404', async () => {
    const q = vi
      .fn()
      .mockResolvedValueOnce([]) // school lock
      .mockResolvedValueOnce([]); // no such order
    const { service } = build(q);
    await expect(
      service.markPaid('missing', { method: PlatformPaymentMethod.GRANT }),
    ).rejects.toThrow(NotFoundException);
  });

  it('createPending prices from the plan: amount is list minus discount, whole paisa', async () => {
    const q = vi.fn();
    const { service, plans } = build(q);
    q.mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ start: '2026-01-01' }])
      .mockResolvedValueOnce([{ id: 'o1' }])
      .mockResolvedValueOnce([
        {
          id: 'o1',
          seats: 10,
          months: 3,
          coupon_id: null,
          discount_paisa: '0',
          amount_paisa: '36000',
          created_at: new Date(),
        },
      ]);
    await service.createPending({
      schoolId: 's1',
      seats: 10,
      months: 3,
      idempotency_key: 'k',
      userId: 'u',
    });
    expect(plans.priceFor).toHaveBeenCalled();
    // INSERT params: unit 1200, amount 10 x 3 x 1200, plan p1, no coupon, discount 0.
    const p = q.mock.calls[2][1];
    expect([p[3], p[4], p[9], p[10], p[11]]).toEqual([1200, 36000, 'p1', null, 0]);
  });

  it('a GRANT keeps its own price, skips the plan and never takes a coupon', async () => {
    const q = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ start: '2026-01-01' }])
      .mockResolvedValueOnce([{ id: 'o1' }])
      .mockResolvedValueOnce([
        {
          id: 'o1',
          seats: 5,
          months: 1,
          coupon_id: null,
          discount_paisa: '0',
          amount_paisa: '0',
          created_at: new Date(),
        },
      ]);
    const { service, plans, coupons } = build(q);
    await service.createPending({
      schoolId: 's1',
      seats: 5,
      months: 1,
      idempotency_key: 'k',
      userId: null,
      unit_price_paisa: 0,
      coupon_code: 'SAVE-10',
    });
    expect(plans.priceFor).not.toHaveBeenCalled();
    expect(coupons.preview).not.toHaveBeenCalled();
    expect(coupons.redeemInTx).not.toHaveBeenCalled();
  });

  it('list never asks the database for more than 100 rows', async () => {
    const { service, dataSource } = build(vi.fn());
    await service.list('s1', 5000);
    expect(dataSource.query.mock.calls[0][1]).toEqual(['s1', 100, 0]);
  });
});
