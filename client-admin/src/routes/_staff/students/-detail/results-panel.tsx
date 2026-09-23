/**
 * [19.9.1] Staff results panel on student detail — every exam this
 * student has a result for, published or not, each unpublished one
 * clearly labelled (issue step 4): staff must never mistake an
 * unpublished grade for one a parent can already see. Same
 * `GET /students/:studentId/results` the portal uses
 * (`StudentResultsController`), but staff get `published: false` rows
 * too since the route's own `isGuardianRole` check never fires for them.
 *
 * Mounted as a tab the same way [19.6.1]'s `SubjectChoicesPanel` is
 * (`$studentId.tsx`).
 */
import { ErrorState, Skeleton } from '@biddaloy/ui/components';
import { useStudentResults } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';

export interface ResultsPanelProps {
  studentId: string;
}

export function ResultsPanel({ studentId }: ResultsPanelProps) {
  const { t } = useTranslation('exams');
  const resultsQuery = useStudentResults(studentId);

  if (resultsQuery.isPending) return <Skeleton className="h-24 w-full" />;
  if (resultsQuery.isError) {
    return (
      <ErrorState
        message={t('studentResultsPanel.loadError')}
        onRetry={() => void resultsQuery.refetch()}
      />
    );
  }

  const rows = resultsQuery.data;
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('studentResultsPanel.empty')}</p>;
  }

  return (
    <table className="w-full border-collapse text-sm">
      <caption className="sr-only">{t('studentResultsPanel.caption')}</caption>
      <thead>
        <tr className="border-b text-start text-muted-foreground">
          <th className="py-1 text-start">{t('studentResultsPanel.columnExam')}</th>
          <th className="py-1 text-start">{t('studentResultsPanel.columnGrade')}</th>
          <th className="py-1 text-start">{t('studentResultsPanel.columnGpa')}</th>
          <th className="py-1 text-start">{t('studentResultsPanel.columnStatus')}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.exam_id} className="border-b border-border-subtle">
            <td className="py-1.5 font-medium">
              {row.exam_name}
              {row.is_fail && (
                <span className="ms-1.5 text-[11px] font-normal text-destructive">
                  {t('studentResultsPanel.failTag')}
                </span>
              )}
            </td>
            <td className="py-1.5">{row.grade}</td>
            <td className="py-1.5 tabular-nums">{row.gpa.toFixed(2)}</td>
            <td className="py-1.5">
              {row.published ? (
                <span className="text-xs text-muted-foreground">
                  {t('studentResultsPanel.published')}
                </span>
              ) : (
                // The one label this panel exists for: staff must never
                // read this row as something a parent can already see.
                <span className="rounded-full border border-status-due-fg px-2 py-0.5 text-xs text-status-due-fg">
                  {t('studentResultsPanel.notPublished')}
                </span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
