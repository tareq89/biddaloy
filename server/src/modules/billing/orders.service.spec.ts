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
    return {
      service: new OrdersService(dataSource as never, entitlement as never, receipts as never),
      receipts,
      entitlement,
      dataSource,
    };
  };

  it('markPaid applies once: payment inserted, recompute and post-commit hooks run', async () => {
    const q = vi
      .fn()
      .mockResolvedValueOnce([]) // school lock
      .mockResolvedValueOnce([[{ id: 'o1', school_id: 's1', amount_paisa: '5000' }], 1]) // UPDATE
      .mockResolvedValueOnce(undefined) // INSERT payment
      .mockResolvedValueOnce(undefined) // receipt advisory lock
      .mockResolvedValueOnce([{ n: '7' }]) // next receipt serial
      .mockResolvedValueOnce(undefined); // UPDATE receipt_number
    const { service, entitlement, receipts } = build(q);
    expect(await service.markPaid('o1', { method: PlatformPaymentMethod.BKASH })).toEqual({
      applied: true,
    });
    // The 7th receipt of the year is numbered SMR-<year>-000007 and its email is queued.
    expect(q.mock.calls[4][1]).toEqual(['o1', expect.stringMatching(/^SMR-\d{4}-000007$/), null]);
    expect(receipts.emailReceipt).toHaveBeenCalledWith('o1');
    expect(entitlement.recompute).toHaveBeenCalledWith('s1', expect.anything());
    expect(entitlement.afterCommit).toHaveBeenCalledWith('s1');
  });

  it('markPaid on an already-paid order does nothing (no payment, no recompute)', async () => {
    const q = vi
      .fn()
      .mockResolvedValueOnce([]) // school lock
      .mockResolvedValueOnce([[], 0]) // conditional UPDATE matched nothing
      .mockResolvedValueOnce([{ '?column?': 1 }]); // the order exists
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
      .mockResolvedValueOnce([[], 0])
      .mockResolvedValueOnce([]);
    const { service } = build(q);
    await expect(
      service.markPaid('missing', { method: PlatformPaymentMethod.GRANT }),
    ).rejects.toThrow(NotFoundException);
  });

  it('list never asks the database for more than 100 rows', async () => {
    const { service, dataSource } = build(vi.fn());
    await service.list('s1', 5000);
    expect(dataSource.query.mock.calls[0][1]).toEqual(['s1', 100, 0]);
  });
});
