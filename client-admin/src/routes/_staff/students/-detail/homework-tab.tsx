/**
 * [22.4.6] "Homework" tab on the student detail page — D13 completion/
 * defaulter rollup for one student, over `GET /homework/analytics/student/
 * :studentId` (`HomeworkAnalyticsService.getStudentRollup`, [22.3.6]).
 * Same read-only-card shape as `attendance-tab.tsx`'s summary card, no
 * grid/list underneath since a rollup has no rows to page through.
 */
import { ApiError } from '@biddaloy/ui/api';
import { Card, EmptyState, ErrorState, Skeleton } from '@biddaloy/ui/components';
import { useStudentHomeworkRollup } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatNumber } from '@biddaloy/ui/utils';
import { NotebookPenIcon } from 'lucide-react';

export interface HomeworkTabProps {
  studentId: string;
}

export function HomeworkTab({ studentId }: HomeworkTabProps) {
  const { t } = useTranslation('students');
  const config = useRegionConfig();
  const query = useStudentHomeworkRollup(studentId);

  if (query.isPending) {
    return (
      <div className="flex flex-col gap-3" aria-busy="true" aria-live="polite">
        <span className="sr-only">{t('detail.homeworkTab.loading')}</span>
        <Skeleton className="h-28 w-full rounded-lg" />
      </div>
    );
  }

  if (query.isError) {
    const forbidden = query.error instanceof ApiError && query.error.statusCode === 403;
    return (
      <ErrorState
        message={forbidden ? t('detail.forbidden') : t('detail.homeworkTab.errorMessage')}
        retryLabel={t('actions.retry', { ns: 'common' })}
        onRetry={() => void query.refetch()}
      />
    );
  }

  const rollup = query.data;

  if (rollup.totalAssignments === 0) {
    return (
      <EmptyState
        icon={<NotebookPenIcon aria-hidden="true" />}
        title={t('detail.homeworkTab.emptyMessage')}
        explanation={t('detail.homeworkTab.emptyExplanation')}
      />
    );
  }

  return (
    <Card padded className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-caption font-normal text-text-secondary">
          {t('detail.homeworkTab.completionPercent')}
        </h2>
        <div className="text-h1 tabular-nums">
          {`${formatNumber(rollup.completionPercent, config)}%`}
        </div>
      </div>
      <dl className="grid grid-cols-3 gap-2 border-t border-border-subtle pt-3">
        <SummaryFigure
          label={t('detail.homeworkTab.totalAssignments')}
          value={rollup.totalAssignments}
        />
        <SummaryFigure label={t('detail.homeworkTab.completed')} value={rollup.completed} />
        <SummaryFigure label={t('detail.homeworkTab.defaulters')} value={rollup.defaulters} />
      </dl>
    </Card>
  );
}

function SummaryFigure({ label, value }: { label: string; value: number }) {
  const config = useRegionConfig();
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-caption text-text-secondary">{label}</dt>
      <dd className="font-semibold tabular-nums">{formatNumber(value, config)}</dd>
    </div>
  );
}
