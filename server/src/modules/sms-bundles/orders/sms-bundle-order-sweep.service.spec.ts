import { describe, it, expect, vi } from 'vitest';
import { SmsBundleOrderSweepService, STALE_ORDER_MS } from './sms-bundle-order-sweep.service';

const now = new Date('2026-11-13T12:00:00Z');

function build(live: (id: string) => Promise<boolean>) {
  const query = vi.fn().mockImplementation(async (sql: string) => {
    if (sql.startsWith('SELECT')) return [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    return [[], 1];
  });
  const svc = new SmsBundleOrderSweepService(
    { query } as never,
    { paymentMayBeLive: live } as never,
  );
  return { svc, query };
}
const updates = (query: ReturnType<typeof vi.fn>) =>
  query.mock.calls.filter(([sql]) => String(sql).startsWith('UPDATE'));

describe('SmsBundleOrderSweepService', () => {
  it('selects only unpaid orders past 24 h with no payment row, then cancels each one', async () => {
    const { svc, query } = build(async () => false);
    expect(await svc.cancelStale(now)).toBe(3);
    const [sql, p] = query.mock.calls[0];
    expect(sql).toMatch(/NOT EXISTS \(SELECT 1 FROM platform_payments/);
    expect(p).toEqual(['PENDING_PAYMENT', new Date(now.getTime() - STALE_ORDER_MS)]);
    expect(updates(query)).toHaveLength(3);
  });

  it('skips an order whose bKash payment may still complete', async () => {
    const { svc, query } = build(async (id) => id === 'b');
    expect(await svc.cancelStale(now)).toBe(2);
    expect(updates(query).map(([, p]) => p[3])).toEqual(['a', 'c']);
  });

  it('Redis unreadable: stops, cancels nothing more', async () => {
    const { svc, query } = build(async (id) => {
      if (id === 'b') throw new Error('redis down');
      return false;
    });
    expect(await svc.cancelStale(now)).toBe(1);
    expect(updates(query)).toHaveLength(1);
  });
});
