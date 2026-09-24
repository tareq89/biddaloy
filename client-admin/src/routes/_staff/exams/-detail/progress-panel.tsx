/**
 * Progress tab — [19.6.1], the exam detail's DEFAULT tab. The submission
 * bar ("87 of 360 grids submitted") sits above a filterable outstanding
 * list; each row is the daily landing point for the exam controller, so
 * it links straight into that section-subject's grid rather than
 * requiring a second click through a summary.
 *
 * [19.7.1] The marks-entry grid page landed at `/marks/$examId/$sectionId
 * /$subjectId` (not `/exams/:examId/marks` as originally sketched here) —
 * a typed router `Link` now, matching that route's real path segments.
 */
import {
  ErrorState,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
} from '@biddaloy/ui/components';
import { useExamProgress } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { Link } from '@tanstack/react-router';
import * as React from 'react';

export interface ProgressPanelProps {
  examId: string;
}

const STATE_FILTER_ALL = 'ALL';

export function ProgressPanel({ examId }: ProgressPanelProps) {
  const { t } = useTranslation('exams');
  const progressQuery = useExamProgress(examId);
  const [stateFilter, setStateFilter] = React.useState<string>(STATE_FILTER_ALL);

  if (progressQuery.isLoading) return <Skeleton className="h-32 w-full" />;
  if (progressQuery.isError)
    return (
      <ErrorState
        message={t('progressPanel.loadError')}
        onRetry={() => void progressQuery.refetch()}
      />
    );

  const counts = progressQuery.data?.counts ?? { DRAFT: 0, SUBMITTED: 0 };
  const total = counts.DRAFT + counts.SUBMITTED;
  const submitted = counts.SUBMITTED;

  const outstanding = (progressQuery.data?.outstanding ?? []).filter(
    (row) => stateFilter === STATE_FILTER_ALL || row.state === stateFilter,
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-md border p-4">
        <p className="text-lg font-semibold">
          {t('progressPanel.submittedOf', { submitted, total })}
        </p>
        <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full bg-primary"
            style={{ width: total > 0 ? `${(submitted / total) * 100}%` : '0%' }}
          />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Select value={stateFilter} onValueChange={setStateFilter}>
          <SelectTrigger aria-label={t('progressPanel.stateFilterLabel')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={STATE_FILTER_ALL}>{t('progressPanel.stateAll')}</SelectItem>
            <SelectItem value="DRAFT">{t('progressPanel.stateDraft')}</SelectItem>
            <SelectItem value="SUBMITTED">{t('progressPanel.stateSubmitted')}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <table className="w-full text-sm">
        <caption className="sr-only">{t('progressPanel.tableCaption')}</caption>
        <thead>
          <tr className="border-b text-left text-muted-foreground">
            <th className="py-2">{t('progressPanel.columnSection')}</th>
            <th className="py-2">{t('progressPanel.columnState')}</th>
          </tr>
        </thead>
        <tbody>
          {outstanding.map((row) => (
            <tr key={`${row.section_id}:${row.subject_id}`} className="border-b">
              <td className="py-2">
                <Link
                  to="/marks/$examId/$sectionId/$subjectId"
                  params={{ examId, sectionId: row.section_id, subjectId: row.subject_id }}
                  className="font-medium text-primary underline"
                >
                  {row.section_name}
                </Link>
              </td>
              <td className="py-2">{t(`progressPanel.state${row.state}`)}</td>
            </tr>
          ))}
          {outstanding.length === 0 && (
            <tr>
              <td colSpan={2} className="py-4 text-center text-muted-foreground">
                {t('progressPanel.empty')}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
