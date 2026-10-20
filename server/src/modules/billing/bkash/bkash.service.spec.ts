import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { SeatOrderStatus } from '@biddaloy/shared';
import { BkashService } from './bkash.service';

const ORDER_ID = '11111111-1111-4111-8111-111111111111';
const SCHOOL = '22222222-2222-4222-8222-222222222222';
const order = {
  id: ORDER_ID,
  school_id: SCHOOL,
  amount_paisa: '300000',
  status: SeatOrderStatus.PENDING,
};
const initiated = {
  statusCode: '0000',
  paymentID: 'PAY1',
  transactionStatus: 'Initiated',
  amount: '3000.00',
  currency: 'BDT',
  merchantInvoiceNumber: ORDER_ID,
};
const completed = { ...initiated, trxID: 'TRX1', transactionStatus: 'Completed' };
const stored = JSON.stringify({
  paymentID: 'PAY1',
  bkash_url: 'https://pay',
  pay_started_at: new Date().toISOString(),
});

function build() {
  const client = {
    isConfigured: vi.fn().mockReturnValue(true),
    create: vi.fn(),
    execute: vi.fn(),
    query: vi.fn(),
  };
  const orders = {
    findForPayment: vi.fn().mockResolvedValue(order),
    markPaid: vi.fn().mockResolvedValue({ applied: true }),
    markFailed: vi.fn(),
  };
  // `get` returns the stored payment for this order by default (a started payment).
  const redis = {
    set: vi.fn().mockResolvedValue('OK'),
    get: vi.fn().mockResolvedValue(stored),
    del: vi.fn().mockResolvedValue(1),
  };
  const dataSource = { query: vi.fn().mockResolvedValue([]) };
  const config = {
    get: (k: string) => (k === 'APP_BASE_URL' ? 'http://localhost:5174' : undefined),
  };
  const svc = new BkashService(
    client as never,
    orders as never,
    config as never,
    dataSource as never,
    redis as never,
  );
  return { svc, client, orders, redis, dataSource };
}

let t: ReturnType<typeof build>;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout'] });
  t = build();
});
afterEach(() => vi.useRealTimers());

/** Runs a callback that may sleep (retry delay) to completion. */
async function callback(status = 'success', paymentID = 'PAY1') {
  const p = t.svc.handleCallback(paymentID, status);
  const settled = p.then(
    (v) => v,
    (e) => e,
  );
  await vi.advanceTimersByTimeAsync(2000);
  const r = await settled;
  if (r instanceof Error) throw r;
  return r;
}

describe('BkashService.startPayment', () => {
  it("creates the payment for the school's own PENDING order and remembers it", async () => {
    t.client.create.mockResolvedValue({
      statusCode: '0000',
      paymentID: 'PAY1',
      bkashURL: 'https://pay',
    });
    expect(await t.svc.startPayment(SCHOOL, ORDER_ID)).toEqual({ bkash_url: 'https://pay' });
    expect(t.client.create).toHaveBeenCalledWith(
      expect.objectContaining({ amountPaisa: '300000', orderId: ORDER_ID }),
    );
    const last = JSON.parse(t.redis.set.mock.calls.at(-1)![1]);
    expect(last).toMatchObject({ paymentID: 'PAY1', bkash_url: 'https://pay' });
    expect(last.pay_started_at).toBeDefined();
  });

  it("answers 404 for another school's order and 409 for one that is not PENDING", async () => {
    await expect(t.svc.startPayment('other-school', ORDER_ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    t.orders.findForPayment.mockResolvedValue({ ...order, status: SeatOrderStatus.PAID });
    await expect(t.svc.startPayment(SCHOOL, ORDER_ID)).rejects.toBeInstanceOf(ConflictException);
  });

  it('marks the order FAILED when bKash refuses to create the payment', async () => {
    t.client.create.mockResolvedValue({ statusCode: '2001' });
    await expect(t.svc.startPayment(SCHOOL, ORDER_ID)).rejects.toThrow();
    expect(t.orders.markFailed).toHaveBeenCalledWith(ORDER_ID);
  });

  it('a second start while a payment is live returns the same page and creates nothing', async () => {
    t.redis.set.mockResolvedValue(null); // NX lost
    expect(await t.svc.startPayment(SCHOOL, ORDER_ID)).toEqual({ bkash_url: 'https://pay' });
    expect(t.client.create).not.toHaveBeenCalled();
  });

  it('a second start while the first is still creating is refused (409)', async () => {
    t.redis.set.mockResolvedValue(null);
    t.redis.get.mockResolvedValue(JSON.stringify({ pay_started_at: new Date().toISOString() }));
    await expect(t.svc.startPayment(SCHOOL, ORDER_ID)).rejects.toBeInstanceOf(ConflictException);
  });

  it('a create that throws leaves the order PENDING (a payment might exist) and frees the lock', async () => {
    t.client.create.mockRejectedValue(new Error('timeout'));
    await expect(t.svc.startPayment(SCHOOL, ORDER_ID)).rejects.toThrow();
    expect(t.orders.markFailed).not.toHaveBeenCalled();
    expect(t.redis.del).toHaveBeenCalled();
  });
});

describe('BkashService.handleCallback', () => {
  it('Completed + matching invoice and amount -> paid once, with the bKash trxID', async () => {
    t.client.query.mockResolvedValue(initiated);
    t.client.execute.mockResolvedValue(completed);
    expect(await callback()).toEqual({ orderId: ORDER_ID, outcome: 'success' });
    expect(t.orders.markPaid).toHaveBeenCalledTimes(1);
    expect(t.orders.markPaid).toHaveBeenCalledWith(
      ORDER_ID,
      expect.objectContaining({ method: 'BKASH', gateway_ref: 'TRX1' }),
    );
  });

  it('amount mismatch (including a non-decimal amount) -> not paid, generic 400', async () => {
    t.client.query.mockResolvedValue(initiated);
    for (const amount of ['1.00', '3000.001', '3e3']) {
      t.client.execute.mockResolvedValue({ ...completed, amount });
      await expect(callback()).rejects.toBeInstanceOf(BadRequestException);
    }
    expect(t.orders.markPaid).not.toHaveBeenCalled();
  });

  it('unknown paymentID (bKash errors) -> generic 400, nothing executed', async () => {
    t.client.query.mockRejectedValue(new Error('bad'));
    await expect(callback('success', 'NOPE')).rejects.toBeInstanceOf(BadRequestException);
    expect(t.client.execute).not.toHaveBeenCalled();
    expect(t.orders.markPaid).not.toHaveBeenCalled();
  });

  it('a paymentID that is not the one we stored for the order is refused before execute', async () => {
    t.client.query.mockResolvedValue({ ...initiated, paymentID: 'OTHER' });
    await expect(callback('success', 'OTHER')).rejects.toBeInstanceOf(BadRequestException);
    expect(t.client.execute).not.toHaveBeenCalled();
  });

  it('Redis down -> cannot match the stored paymentID -> refused, nothing executed', async () => {
    t.client.query.mockResolvedValue(initiated);
    t.redis.get.mockRejectedValue(new Error('down'));
    await expect(callback()).rejects.toBeInstanceOf(BadRequestException);
    expect(t.client.execute).not.toHaveBeenCalled();
  });

  it('a second callback after the order is PAID executes nothing and pays nothing', async () => {
    t.client.query.mockResolvedValue(completed);
    t.orders.findForPayment.mockResolvedValue({ ...order, status: SeatOrderStatus.PAID });
    expect(await callback()).toEqual({ orderId: ORDER_ID, outcome: 'success' });
    expect(t.client.execute).not.toHaveBeenCalled();
    expect(t.orders.markPaid).not.toHaveBeenCalled();
  });

  it('a "success" in the URL is not believed: bKash never says Completed -> nothing is paid', async () => {
    t.client.query.mockResolvedValue(initiated);
    t.client.execute.mockResolvedValue({ ...initiated });
    await callback();
    expect(t.orders.markPaid).not.toHaveBeenCalled();
  });

  it('execute fails (timeout) -> one more query after a short wait, and it still pays', async () => {
    t.client.query.mockResolvedValueOnce(initiated).mockResolvedValueOnce(completed);
    t.client.execute.mockRejectedValue(new Error('timeout'));
    await callback();
    expect(t.client.query).toHaveBeenCalledTimes(2);
    expect(t.orders.markPaid).toHaveBeenCalledTimes(1);
  });

  it('a cancelled return leaves the order PENDING and reports the outcome', async () => {
    t.client.query.mockResolvedValue(initiated);
    expect(await callback('cancel')).toEqual({ orderId: ORDER_ID, outcome: 'cancel' });
    expect(t.client.execute).not.toHaveBeenCalled();
    expect(t.orders.markPaid).not.toHaveBeenCalled();
    expect(t.orders.markFailed).not.toHaveBeenCalled();
  });

  it('markPaid applied:false (a race) is logged loudly, not swallowed silently', async () => {
    t.client.query.mockResolvedValue(completed);
    t.orders.markPaid.mockResolvedValue({ applied: false });
    const err = vi.spyOn(t.svc['logger'], 'error').mockImplementation(() => undefined);
    await callback();
    expect(err).toHaveBeenCalledWith(expect.stringContaining('double payment'));
  });
});

describe('BkashService.reconcilePending', () => {
  it('settles a PENDING order whose callback never came, skipping ones with no remembered payment', async () => {
    t.dataSource.query.mockResolvedValue([{ id: ORDER_ID }, { id: 'no-payment' }]);
    t.redis.get.mockImplementation(async (k: string) => (k.endsWith(ORDER_ID) ? stored : null));
    t.client.query.mockResolvedValue(completed);
    expect(await t.svc.reconcilePending()).toBe(1);
    expect(t.orders.markPaid).toHaveBeenCalledTimes(1);
  });

  it('ignores a payment started more than 24 h ago', async () => {
    t.dataSource.query.mockResolvedValue([{ id: ORDER_ID }]);
    t.redis.get.mockResolvedValue(
      JSON.stringify({ paymentID: 'PAY1', pay_started_at: '2020-01-01T00:00:00.000Z' }),
    );
    expect(await t.svc.reconcilePending()).toBe(0);
    expect(t.client.query).not.toHaveBeenCalled();
  });
});
