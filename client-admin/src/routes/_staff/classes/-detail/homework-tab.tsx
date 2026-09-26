/**
 * [22.4.6] "Homework" tab on the class detail page — D13 completion/
 * defaulter rollup plus D29 syllabus-completion %, both over `GET
 * /homework/analytics/class/:classId` (`HomeworkAnalyticsService.
 * getClassRollup`, [22.3.6], which already computes the syllabus rollup
 * server-side — no second endpoint needed here).
 *
 * There is no separate section-level detail route in this app (`/classes/
 * $classId`'s own "Sections" tab is a list, not a route) — `GET .../
 * analytics/section/:id` has no page to live on, so this ticket only wires
 * the student and class tabs. See the ticket's descope note.
 */
import { ApiError } from '@biddaloy/ui/api';
import { Card, ErrorState, Skeleton } from '@biddaloy/ui/components';
import { useClassHomeworkRollup } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { renderDigits } from '@biddaloy/ui/utils';

export interface HomeworkTabProps {
  classId: string;
}

export function HomeworkTab({ classId }: HomeworkTabProps) {
  const { t } = useTranslation('classes');
  const config = useRegionConfig();
  const query = useClassHomeworkRollup(classId);

  if (query.isPending) {
    return (
      <div className="flex flex-col gap-3" aria-busy="true" aria-live="polite">
        <span className="sr-only">{t('detail.homework.loading')}</span>
        <Skeleton className="h-28 w-full rounded-lg" />
        <Skeleton className="h-28 w-full rounded-lg" />
      </div>
    );
  }

  if (query.isError) {
    const forbidden = query.error instanceof ApiError && query.error.statusCode === 403;
    return (
      <ErrorState
        message={forbidden ? t('detail.forbidden') : t('detail.homework.errorMessage')}
        retryLabel={t('actions.retry', { ns: 'common' })}
        onRetry={() => void query.refetch()}
      />
    );
  }

  const rollup = query.data;

  if (rollup.totalAssignments === 0 && rollup.syllabus.totalTopics === 0) {
    return (
      <Card className="p-3.5">
        <p className="text-sm text-muted-foreground">{t('detail.homework.emptyMessage')}</p>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <Card className="flex flex-col gap-3 p-4">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-sm font-normal text-muted-foreground">
            {t('detail.homework.completionPercent')}
          </h2>
          <div className="text-3xl leading-tight font-bold tabular-nums">
            {renderDigits(`${rollup.completionPercent}%`, config.numerals)}
          </div>
        </div>
        <dl className="grid grid-cols-3 gap-2 border-t border-border-subtle pt-3">
          <SummaryFigure
            label={t('detail.homework.totalAssignments')}
            value={rollup.totalAssignments}
          />
          <SummaryFigure label={t('detail.homework.completed')} value={rollup.completed} />
          <SummaryFigure label={t('detail.homework.defaulters')} value={rollup.defaulters} />
        </dl>
      </Card>

      <Card className="flex flex-col gap-0.5 p-4">
        <h2 className="text-sm font-normal text-muted-foreground">
          {t('detail.homework.syllabusCompletionPercent')}
        </h2>
        <div className="text-3xl leading-tight font-bold tabular-nums">
          {renderDigits(`${rollup.syllabus.completionPercent}%`, config.numerals)}
        </div>
        <div className="text-xs text-muted-foreground">
          {t('detail.homework.syllabusTopics', {
            done: rollup.syllabus.done,
            total: rollup.syllabus.totalTopics,
          })}
        </div>
      </Card>
    </div>
  );
}

function SummaryFigure({ label, value }: { label: string; value: number }) {
  const config = useRegionConfig();
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className="text-sm font-semibold tabular-nums">
        {renderDigits(String(value), config.numerals)}
      </dd>
    </div>
  );
}
