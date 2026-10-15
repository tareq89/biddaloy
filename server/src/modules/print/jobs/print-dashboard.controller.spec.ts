import { describe, it, expect, vi } from 'vitest';
import { DashboardWidgetKey } from '@biddaloy/shared';
import { PrintDashboardController } from './print-dashboard.controller';

/** [8.10.7.7.02] The card is the queue's counts, school-wide cache, and never carries the exam list. */
describe('PrintDashboardController', () => {
  it('returns total + by_kind only, cached under the school scope', async () => {
    const queueCounts = vi.fn().mockResolvedValue({
      total: 4,
      by_kind: [{ kind: 'EXAM_ADMIT_CARD', count: 4 }],
      exams: [{ exam_id: 'x', exam_name: 'Midterm', class_name: 'Six', missing: 4 }],
    });
    const getOrLoad = vi.fn((_t, _k, _s, load) => load());
    const controller = new PrintDashboardController({ queueCounts } as any, { getOrLoad } as any);

    const res = await controller.queue({ id: 'tenant-1' });

    expect(res).toEqual({ total: 4, by_kind: [{ kind: 'EXAM_ADMIT_CARD', count: 4 }] });
    expect(getOrLoad).toHaveBeenCalledWith(
      'tenant-1',
      DashboardWidgetKey.PRINT_QUEUE,
      'school',
      expect.any(Function),
    );
    expect(queueCounts).toHaveBeenCalledWith('tenant-1');
  });
});
