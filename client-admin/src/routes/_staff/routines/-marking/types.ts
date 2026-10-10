import type { LessonDeliveriesDay } from '@biddaloy/ui/hooks';

export type MarkingPeriod = LessonDeliveriesDay['periods'][number];

export type PeriodState = 'reported' | 'left' | 'auto' | 'noPlan';

/** D8: cancelled / auto rows need no input; D35: no plan, nothing to report. */
export function periodState(p: MarkingPeriod): PeriodState {
  if (p.cancelled || p.delivery?.auto) return 'auto';
  if (!p.plan_id) return 'noPlan';
  return p.delivery ? 'reported' : 'left';
}
