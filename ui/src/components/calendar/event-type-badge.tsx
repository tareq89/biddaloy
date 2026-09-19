import { CalendarEventType } from '@biddaloy/shared';

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
  [CalendarEventType.HOLIDAY]: 'bg-status-paid-bg text-status-paid-fg',
  [CalendarEventType.EXAM]: 'bg-status-overdue-bg text-status-overdue-fg',
  [CalendarEventType.EVENT]: 'bg-status-partial-bg text-status-partial-fg',
  [CalendarEventType.MEETING]: 'bg-status-due-bg text-status-due-fg',
  [CalendarEventType.DEADLINE]: 'bg-muted text-muted-foreground',
};

export function EventTypeBadge({ type, label, className }: EventTypeBadgeProps) {
  return (
    <span
      className={[
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
        TYPE_TONE_CLASSES[type],
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {label}
    </span>
  );
}
