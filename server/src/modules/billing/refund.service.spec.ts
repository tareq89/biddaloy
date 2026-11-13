import { describe, it, expect, vi } from 'vitest';
import { REFUND_NOTE, RefundService } from './refund.service';

/** [100.3.06] State rules with the database faked: one query answer per call, in order. */
function build(answers: unknown[], credits: Record<string, unknown> = {}) {
  const query = vi.fn();
  for (const a of answers) query.mockResolvedValueOnce(a);
  query.mockResolvedValue([]);
  const manager = { query };
  const ds = {
    transaction: vi.fn((fn: (m: unknown) => unknown) => fn(manager)),
    query: vi.fn().mockResolvedValue([]),
  };
  const entitlement = { recompute: vi.fn(), afterCommit: vi.fn() };
  const audit = { record: vi.fn() };
  const notices = { refundDone: vi.fn() };
  const svc = new RefundService(
    ds as never,
    entitlement as never,
    credits as never,
    audit as never,
    notices as never,
  );
  return { svc, query, entitlement, audit, notices, ds };
}

describe('RefundService', () => {
  it('seat: PAID -> REFUNDED recomputes, audits and notifies after commit', async () => {
    const t = build([[{ school_id: 's1' }], [], [[{ amount_paisa: '5000' }], 1]]);
    const res = await t.svc.refundSeatOrder('o1', 'Paid twice', 'u1');
    expect(res).toEqual({ applied: true, order_id: 'o1', gateway_ref: null, note: REFUND_NOTE });
    expect(t.entitlement.recompute).toHaveBeenCalledWith('s1', expect.anything());
    expect(t.audit.record).toHaveBeenCalledTimes(1);
    expect(t.entitlement.afterCommit).toHaveBeenCalledWith('s1');
    expect(t.notices.refundDone).toHaveBeenCalledWith('o1');
  });

  it('seat: already REFUNDED is a replay, nothing else runs', async () => {
    const t = build([[{ school_id: 's1' }], [], [[], 0], [{ status: 'REFUNDED' }]]);
    const res = await t.svc.refundSeatOrder('o1', 'Paid twice', 'u1');
    expect(res.applied).toBe(false);
    expect(t.entitlement.recompute).not.toHaveBeenCalled();
    expect(t.audit.record).not.toHaveBeenCalled();
    expect(t.notices.refundDone).not.toHaveBeenCalled();
  });

  it('seat: PENDING / FAILED / GRANT is 409 ORDER_NOT_REFUNDABLE; unknown order is 404', async () => {
    const t = build([[{ school_id: 's1' }], [], [[], 0], [{ status: 'PENDING' }]]);
    await expect(t.svc.refundSeatOrder('o1', 'Paid twice', 'u1')).rejects.toMatchObject({
      response: { details: { code: 'ORDER_NOT_REFUNDABLE' } },
    });
    await expect(build([[]]).svc.refundSeatOrder('o1', 'Paid twice', 'u1')).rejects.toMatchObject({
      status: 404,
    });
  });

  it('bundle: only ACTIVE refunds; the credit service closes the lot', async () => {
    const closeUntouchedLot = vi.fn().mockResolvedValue({ closed: true, units: 100 });
    const t = build(
      [[{ school_id: 's1', status: 'ACTIVE', price_paisa: '9' }], [[{ id: 'o1' }], 1]],
      {
        closeUntouchedLot,
      },
    );
    expect((await t.svc.refundBundleOrder('o1', 'Wrong pack', 'u1')).applied).toBe(true);
    expect(closeUntouchedLot).toHaveBeenCalledWith(expect.anything(), 's1', 'o1');
    expect(t.notices.refundDone).toHaveBeenCalledWith('o1');

    for (const status of ['PENDING_PAYMENT', 'PAID', 'USED_UP', 'EXPIRED', 'CANCELLED']) {
      const u = build([[{ school_id: 's1', status, price_paisa: '9' }]], { closeUntouchedLot });
      await expect(u.svc.refundBundleOrder('o1', 'Wrong pack', 'u1')).rejects.toMatchObject({
        response: { details: { code: 'ORDER_NOT_REFUNDABLE' } },
      });
    }
  });

  it('bundle: REFUNDED is a replay and never touches the credit service', async () => {
    const closeUntouchedLot = vi.fn();
    const t = build([[{ school_id: 's1', status: 'REFUNDED', price_paisa: '9' }]], {
      closeUntouchedLot,
    });
    expect((await t.svc.refundBundleOrder('o1', 'Wrong pack', 'u1')).applied).toBe(false);
    expect(closeUntouchedLot).not.toHaveBeenCalled();
    expect(t.notices.refundDone).not.toHaveBeenCalled();
  });

  it('bundle: a used package surfaces BUNDLE_ALREADY_USED and notifies nobody', async () => {
    const err = Object.assign(new Error('used'), {
      response: { details: { code: 'BUNDLE_ALREADY_USED' } },
    });
    const t = build([[{ school_id: 's1', status: 'ACTIVE', price_paisa: '9' }]], {
      closeUntouchedLot: vi.fn().mockRejectedValue(err),
    });
    await expect(t.svc.refundBundleOrder('o1', 'Wrong pack', 'u1')).rejects.toBe(err);
    expect(t.notices.refundDone).not.toHaveBeenCalled();
  });
});
