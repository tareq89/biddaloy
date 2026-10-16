import { describe, it, expect, vi } from 'vitest';
import { DashboardWidgetKey, UserRole } from '@biddaloy/shared';
import { ApplicationsDashboardService } from './applications-dashboard.service';

/** [8.10.7.7.01] The widget is the inbox count, cached per reviewer (counts differ per user). */
describe('ApplicationsDashboardService', () => {
  const body = { total: 3, by_type: [{ type: 'STAFF_LEAVE', count: 3 }], oldest_pending_at: null };

  it('returns the inbox count for the caller, cached under user:<id>', async () => {
    const pendingCount = vi.fn().mockResolvedValue(body);
    const getOrLoad = vi.fn((_t, _k, _s, load) => load());
    const service = new ApplicationsDashboardService({ pendingCount } as any, { getOrLoad } as any);

    const res = await service.getApprovalsPending('tenant-1', {
      userId: 'u-1',
      role: UserRole.ADMIN,
    });

    expect(res).toBe(body);
    expect(getOrLoad).toHaveBeenCalledWith(
      'tenant-1',
      DashboardWidgetKey.APPROVALS_PENDING,
      'user:u-1',
      expect.any(Function),
    );
    expect(pendingCount).toHaveBeenCalledWith('tenant-1', { userId: 'u-1', role: UserRole.ADMIN });
  });
});
