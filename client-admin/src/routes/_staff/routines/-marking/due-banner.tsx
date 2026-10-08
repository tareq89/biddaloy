/** [66.3.01] D34: warns about earlier days still unreported, before escalation. */
import { Button } from '@biddaloy/ui/components';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatDate, formatWeekday } from '@biddaloy/ui/utils';
import { TriangleAlertIcon } from 'lucide-react';

import { addDays } from './dates';

export interface DueBannerProps {
  due: {
    unreported_periods: number;
    oldest_date: string | null;
    school_days_until_escalation: number;
  };
  today: string;
  onReport: (date: string) => void;
}

export function DueBanner({ due, today, onReport }: DueBannerProps) {
  const { t } = useTranslation('routines');
  const config = useRegionConfig();
  if (due.unreported_periods <= 0 || !due.oldest_date) return null;
  const oldest = due.oldest_date;
  const yesterday = oldest === addDays(today, -1);
  const title = yesterday
    ? t('marking.due.title', { count: due.unreported_periods })
    : t('marking.due.titleSince', {
        count: due.unreported_periods,
        date: `${formatWeekday(oldest, config)}, ${formatDate(oldest, config)}`,
      });
  const body =
    due.school_days_until_escalation <= 0
      ? t('marking.due.escalated')
      : t('marking.due.escalation', { count: due.school_days_until_escalation });
  return (
    <div
      role="status"
      className="flex flex-col gap-3 rounded-lg border border-status-due-fg bg-status-due-bg p-4 text-status-due-fg"
    >
      <div className="flex items-start gap-2">
        <TriangleAlertIcon aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
        <div className="flex flex-col gap-1">
          <p className="font-semibold">{title}</p>
          <p className="text-body">{body}</p>
        </div>
      </div>
      <Button
        variant="outline"
        className="h-14 w-full bg-surface text-text-primary md:h-11 md:w-fit"
        onClick={() => onReport(oldest)}
      >
        {yesterday
          ? t('marking.due.action')
          : t('marking.due.actionDay', { weekday: formatWeekday(oldest, config) })}
      </Button>
    </div>
  );
}
