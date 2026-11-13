import { describe, it, expect, vi } from 'vitest';
import { SmsBundleOrderSweepService, STALE_ORDER_MS } from './sms-bundle-order-sweep.service';

describe('SmsBundleOrderSweepService', () => {
  it('cancels PENDING_PAYMENT older than 24 h in one UPDATE', async () => {
    const query = vi.fn().mockResolvedValue([[], 3]);
    const now = new Date('2026-11-13T12:00:00Z');
    expect(await new SmsBundleOrderSweepService({ query } as never).cancelStale(now)).toBe(3);
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, p] = query.mock.calls[0];
    expect(sql).toMatch(/^UPDATE sms_bundle_orders/);
    expect(p[1]).toBe('PENDING_PAYMENT');
    expect(p[3]).toEqual(new Date(now.getTime() - STALE_ORDER_MS));
  });
});
