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
  // By default a payment PAY1 was started for this order: `bkash:pid:PAY1` names the order and
  // `bkash:pay:<order>` holds the stored payment.
  const redis = {
    set: vi.fn().mockResolvedValue('OK'),
    get: vi.fn().mockImplementation(async (k: string) => {
      if (k.startsWith('bkash:pid:')) return k === 'bkash:pid:PAY1' ? ORDER_ID : null;
      return stored;
    }),
    del: vi.fn().mockResolvedValue(1),
    exists: vi.fn().mockResolvedValue(0),
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

/** The `details.code` a ConflictException carries. */
async function conflictCode(p: Promise<unknown>): Promise<unknown> {
  const err = await p.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(ConflictException);
  return ((err as ConflictException).getResponse() as { details?: { code?: string } }).details
    ?.code;
}

describe('BkashService.startPayment', () => {
  // No payment started yet for this order.
  beforeEach(() => t.redis.get.mockResolvedValue(null));

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
    const pay = t.redis.set.mock.calls.find((c) => c[0] === `bkash:pay:${ORDER_ID}`)!;
    const state = JSON.parse(pay[1]);
    expect(state).toMatchObject({ paymentID: 'PAY1', bkash_url: 'https://pay' });
    expect(state.pay_started_at).toBeDefined();
    // The callback finds the order from the paymentID without asking bKash.
    expect(t.redis.set).toHaveBeenCalledWith('bkash:pid:PAY1', ORDER_ID, 'EX', expect.any(Number));
    // The creating lock is released.
    expect(t.redis.del).toHaveBeenCalledWith(`bkash:creating:${ORDER_ID}`);
  });

  it("answers 404 for another school's order and 409 ORDER_NOT_PENDING for one that is not PENDING", async () => {
    await expect(t.svc.startPayment('other-school', ORDER_ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    t.orders.findForPayment.mockResolvedValue({ ...order, status: SeatOrderStatus.PAID });
    expect(await conflictCode(t.svc.startPayment(SCHOOL, ORDER_ID))).toBe('ORDER_NOT_PENDING');
  });

  it('marks the order FAILED when bKash refuses to create the payment', async () => {
    t.client.create.mockResolvedValue({ statusCode: '2001' });
    await expect(t.svc.startPayment(SCHOOL, ORDER_ID)).rejects.toThrow();
    expect(t.orders.markFailed).toHaveBeenCalledWith(ORDER_ID);
  });

  it('a second start while a payment is live returns the same page and creates nothing', async () => {
    t.redis.get.mockResolvedValue(stored);
    expect(await t.svc.startPayment(SCHOOL, ORDER_ID)).toEqual({ bkash_url: 'https://pay' });
    expect(t.client.create).not.toHaveBeenCalled();
  });

  it('a second start while the first is still creating is 409 PAYMENT_STARTING', async () => {
    t.redis.set.mockResolvedValue(null); // creating lock lost
    expect(await conflictCode(t.svc.startPayment(SCHOOL, ORDER_ID))).toBe('PAYMENT_STARTING');
    expect(t.client.create).not.toHaveBeenCalled();
  });

  it('a create that throws leaves the order PENDING (a payment might exist) and frees the lock', async () => {
    t.client.create.mockRejectedValue(new Error('timeout'));
    await expect(t.svc.startPayment(SCHOOL, ORDER_ID)).rejects.toThrow();
    expect(t.orders.markFailed).not.toHaveBeenCalled();
    expect(t.redis.del).toHaveBeenCalledWith(`bkash:creating:${ORDER_ID}`);
  });

  it('after a cancelled return (checkout URL dropped) Pay creates a new payment, not the dead page', async () => {
    t.redis.get.mockResolvedValue(
      JSON.stringify({ paymentID: 'PAY1', pay_started_at: new Date().toISOString() }),
    );
    t.client.create.mockResolvedValue({
      statusCode: '0000',
      paymentID: 'PAY2',
      bkashURL: 'https://new',
    });
    expect(await t.svc.startPayment(SCHOOL, ORDER_ID)).toEqual({ bkash_url: 'https://new' });
    expect(t.client.create).toHaveBeenCalledTimes(1);
  });

  it('a refused create after an earlier payment keeps the order PENDING (that payment may still land)', async () => {
    t.redis.get.mockResolvedValue(
      JSON.stringify({ paymentID: 'PAY1', pay_started_at: new Date().toISOString() }),
    );
    t.client.create.mockResolvedValue({ statusCode: '2001' });
    await expect(t.svc.startPayment(SCHOOL, ORDER_ID)).rejects.toThrow();
    expect(t.orders.markFailed).not.toHaveBeenCalled();
  });
});

/** The orphan `platform_payments` insert, if one was made. */
function orphanInsert() {
  const call = t.dataSource.query.mock.calls.find((c) =>
    String(c[0]).includes('INSERT INTO platform_payments'),
  );
  return call && { sql: String(call[0]), params: call[1] as unknown[] };
}

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

  it('amount mismatch (including a non-decimal amount) -> not paid, generic 400, money kept as an orphan', async () => {
    t.client.query.mockResolvedValue(initiated);
    for (const amount of ['1.00', '3000.001', '3e3']) {
      t.client.execute.mockResolvedValue({ ...completed, amount });
      await expect(callback()).rejects.toBeInstanceOf(BadRequestException);
    }
    expect(t.orders.markPaid).not.toHaveBeenCalled();
    // bKash captured the money: it is recorded, keyed on trxID, flagged for a refund.
    const ins = orphanInsert()!;
    expect(ins.sql).toContain('ON CONFLICT (method, gateway_ref) DO NOTHING');
    expect(ins.params.slice(0, 3)).toEqual([ORDER_ID, 'BKASH', 'TRX1']);
    expect(JSON.parse(ins.params[4] as string)).toMatchObject({
      orphan: true,
      orphan_reason: 'MISMATCH',
      trxID: 'TRX1',
    });
  });

  it('an unrecordable mismatch (DB down) still answers the generic 400', async () => {
    t.client.query.mockResolvedValue(initiated);
    t.client.execute.mockResolvedValue({ ...completed, currency: 'USD' });
    t.dataSource.query.mockRejectedValue(new Error('db down'));
    await expect(callback()).rejects.toBeInstanceOf(BadRequestException);
  });

  it('a paymentID we never created is refused with no bKash call at all', async () => {
    await expect(callback('success', 'NOPE')).rejects.toBeInstanceOf(BadRequestException);
    expect(t.client.query).not.toHaveBeenCalled();
    expect(t.client.execute).not.toHaveBeenCalled();
    expect(t.orders.markPaid).not.toHaveBeenCalled();
  });

  it('a paymentID that is not bKash-shaped is refused before Redis or bKash', async () => {
    for (const bad of ['PAY 1', 'PAY-1', '../x', 'a'.repeat(65)]) {
      await expect(callback('success', bad)).rejects.toBeInstanceOf(BadRequestException);
    }
    expect(t.redis.get).not.toHaveBeenCalled();
    expect(t.client.query).not.toHaveBeenCalled();
  });

  it('a known paymentID that bKash does not know -> generic 400, nothing executed', async () => {
    t.client.query.mockRejectedValue(new Error('bad'));
    await expect(callback()).rejects.toBeInstanceOf(BadRequestException);
    expect(t.client.execute).not.toHaveBeenCalled();
  });

  it('bKash naming a different order than the one we stored for the paymentID is refused', async () => {
    t.client.query.mockResolvedValue({
      ...initiated,
      merchantInvoiceNumber: '33333333-3333-4333-8333-333333333333',
    });
    await expect(callback()).rejects.toBeInstanceOf(BadRequestException);
    expect(t.client.execute).not.toHaveBeenCalled();
  });

  it('a paymentID that is not the one we stored for the order is refused before execute', async () => {
    // OTHER was created for this order once, but the order's current payment is PAY1.
    t.redis.get.mockImplementation(async (k: string) =>
      k.startsWith('bkash:pid:') ? ORDER_ID : stored,
    );
    t.client.query.mockResolvedValue({ ...initiated, paymentID: 'OTHER' });
    await expect(callback('success', 'OTHER')).rejects.toBeInstanceOf(BadRequestException);
    expect(t.client.execute).not.toHaveBeenCalled();
  });

  it('Redis down -> cannot match the paymentID -> refused, nothing asked or executed', async () => {
    t.client.query.mockResolvedValue(initiated);
    t.redis.get.mockRejectedValue(new Error('down'));
    await expect(callback()).rejects.toBeInstanceOf(BadRequestException);
    expect(t.client.query).not.toHaveBeenCalled();
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
    // The checkout page is dead: dropped from the state, paymentID kept, TTL kept.
    const pay = t.redis.set.mock.calls.find((c) => c[0] === `bkash:pay:${ORDER_ID}`)!;
    expect(JSON.parse(pay[1])).toEqual({
      paymentID: 'PAY1',
      pay_started_at: expect.any(String),
    });
    expect(pay[2]).toBe('KEEPTTL');
  });

  it('a failed return drops the checkout URL too; a success return does not', async () => {
    t.client.query.mockResolvedValue(initiated);
    await callback('failure');
    expect(t.redis.set).toHaveBeenCalledTimes(1);
    t.redis.set.mockClear();
    t.client.execute.mockResolvedValue(completed);
    await callback('success');
    expect(t.redis.set).not.toHaveBeenCalled();
  });

  it('markPaid applied:false (order settled another way) is logged loudly and kept as an orphan', async () => {
    t.client.query.mockResolvedValue(completed);
    t.orders.markPaid.mockResolvedValue({ applied: false });
    const err = vi.spyOn(t.svc['logger'], 'error').mockImplementation(() => undefined);
    await callback();
    expect(err).toHaveBeenCalledWith(expect.stringContaining('double payment'));
    const ins = orphanInsert()!;
    expect(ins.params.slice(0, 4)).toEqual([ORDER_ID, 'BKASH', 'TRX1', '300000']);
    expect(JSON.parse(ins.params[4] as string)).toMatchObject({
      orphan: true,
      orphan_reason: 'ORDER_NOT_PENDING',
    });
  });

  it('a normal payment writes no orphan row', async () => {
    t.client.query.mockResolvedValue(completed);
    await callback();
    expect(orphanInsert()).toBeUndefined();
  });
});

describe('BkashService.paymentMayBeLive (guards an offline payment)', () => {
  const at = (ms: number) =>
    JSON.stringify({ paymentID: 'PAY1', pay_started_at: new Date(Date.now() - ms).toISOString() });

  it('true while a payment is being created or was started under 24 h ago', async () => {
    t.redis.exists.mockResolvedValueOnce(1);
    expect(await t.svc.paymentMayBeLive(ORDER_ID)).toBe(true);
    t.redis.get.mockResolvedValue(at(23 * 3_600_000));
    expect(await t.svc.paymentMayBeLive(ORDER_ID)).toBe(true);
  });

  it('false with no payment, or one past the 24 h window', async () => {
    t.redis.get.mockResolvedValue(null);
    expect(await t.svc.paymentMayBeLive(ORDER_ID)).toBe(false);
    t.redis.get.mockResolvedValue(at(25 * 3_600_000));
    expect(await t.svc.paymentMayBeLive(ORDER_ID)).toBe(false);
  });

  it('a Redis error propagates (the caller fails closed)', async () => {
    t.redis.exists.mockRejectedValue(new Error('down'));
    await expect(t.svc.paymentMayBeLive(ORDER_ID)).rejects.toThrow('down');
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
