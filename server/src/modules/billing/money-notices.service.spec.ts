import { describe, it, expect, vi } from 'vitest';
import { MoneyNoticesService } from './money-notices.service';

function make(rows: unknown[], notify = vi.fn().mockResolvedValue(undefined)) {
  const ds = { query: vi.fn().mockResolvedValue(rows) };
  const config = { get: () => undefined };
  const svc = new MoneyNoticesService(
    ds as never,
    config as never,
    { notifyAdmins: notify } as never,
  );
  return { svc, notify };
}

describe('MoneyNoticesService', () => {
  it('couponApplied emails only, with code and discount in taka', async () => {
    const { svc, notify } = make([{ school_id: 's1', code: 'E2E-HALF', discount: '50000' }]);
    await svc.couponApplied('o1');
    expect(notify).toHaveBeenCalledWith(
      's1',
      'coupon_applied',
      expect.objectContaining({ coupon: 'E2E-HALF', amount: '500.00' }),
      { emailOnly: true },
    );
  });

  it('refundDone emails only', async () => {
    const { svc, notify } = make([{ school_id: 's1', amount: '150000' }]);
    await svc.refundDone('o1');
    expect(notify).toHaveBeenCalledWith(
      's1',
      'refund_done',
      expect.objectContaining({ amount: '1500.00' }),
      {
        emailOnly: true,
      },
    );
  });

  it('sends nothing for an unknown or unrefunded order', async () => {
    const { svc, notify } = make([]);
    await svc.couponApplied('x');
    await svc.refundDone('x');
    expect(notify).not.toHaveBeenCalled();
  });

  it('planChanged emails only and never throws when the notice fails', async () => {
    const { svc, notify } = make([], vi.fn().mockRejectedValue(new Error('boom')));
    await expect(svc.planChanged('s1', 'Plus')).resolves.toBeUndefined();
    expect(notify).toHaveBeenCalledWith(
      's1',
      'plan_changed',
      { plan: 'Plus' },
      { emailOnly: true },
    );
  });
});
