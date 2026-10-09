import { CalendarEventType } from '@biddaloy/shared';

import { cn } from '../../primitives/lib/utils';

/**
 * Presentational chip for a `CalendarEventType`. Reuses `@biddaloy/ui`'s
 * `status-*` colour tokens (the same four tones `StatusBadge` draws
 * from) instead of ad-hoc colours — this is not a `StatusBadge` domain
 * itself because a calendar event's "type" isn't a lifecycle status, but
 * the five types map onto the same tone vocabulary. Pure props in, JSX
 * out — no data hooks, so [17.5.2]'s portal calendar can reuse it as-is.
 */
export interface EventTypeBadgeProps {
  type: CalendarEventType;
  label: string;
  className?: string;
}

const TYPE_TONE_CLASSES: Record<CalendarEventType, string> = {
  [CalendarEventType.EXAM]: 'bg-status-partial-bg text-status-partial-fg',
  [CalendarEventType.HOLIDAY]: 'bg-status-overdue-bg text-status-overdue-fg',
  [CalendarEventType.DEADLINE]: 'bg-status-due-bg text-status-due-fg',
  [CalendarEventType.EVENT]: 'bg-secondary text-secondary-foreground',
  [CalendarEventType.MEETING]: 'bg-secondary text-secondary-foreground',
};

/** Small solid dot per type — phone grid cells and the day / agenda rows. */
export const EVENT_DOT_CLASSES: Record<CalendarEventType, string> = {
  [CalendarEventType.EXAM]: 'bg-status-partial-fg',
  [CalendarEventType.HOLIDAY]: 'bg-status-overdue-fg',
  [CalendarEventType.DEADLINE]: 'bg-status-due-fg',
  [CalendarEventType.EVENT]: 'bg-primary',
  [CalendarEventType.MEETING]: 'bg-primary',
};

export function EventTypeBadge({ type, label, className }: EventTypeBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
        TYPE_TONE_CLASSES[type],
        className,
      )}
    >
      {label}
    </span>
  );
}
