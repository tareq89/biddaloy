/**
 * [19.8.1] Results landing page — the palette's navigate target for
 * Process/Publish/Send-SMS (`action-registry.ts`'s `ActionRunContext`
 * carries no entity id, same "lands on the list, not a specific record"
 * pattern `grading.copyScale` already uses). Pick an exam, get the same
 * `ResultsPanel` the exam detail's Results tab renders — one component,
 * two entry points, no second copy of the table/dialogs.
 */
import {
  ErrorState,
  RoutePending,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
} from '@biddaloy/ui/components';
import { examsQueryOptions, useExams } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { createFileRoute } from '@tanstack/react-router';
import * as React from 'react';

import { loadRouteNamespaces, swallowUnlessOffline } from '../../../route-loaders';
import { ResultsPanel } from '../exams/-detail/results-panel';

export const Route = createFileRoute('/_staff/results/')({
  loader: ({ context: { queryClient } }) =>
    Promise.all([
      queryClient.ensureQueryData(examsQueryOptions({})).catch(swallowUnlessOffline),
      loadRouteNamespaces('exams', 'common'),
    ]),
  pendingComponent: ResultsListPending,
  component: ResultsListPage,
});

function ResultsListPage() {
  const { t } = useTranslation('exams');
  const examsQuery = useExams({ limit: 50 });
  const exams = examsQuery.data?.data ?? [];
  const [examId, setExamId] = React.useState<string | undefined>(undefined);
  const selectedExamId = examId ?? exams[0]?.id;
  const selectedExam = exams.find((exam) => exam.id === selectedExamId);

  return (
    <div className="flex flex-col gap-4 p-4">
      <h1 className="text-lg font-semibold">{t('resultsRoute.title')}</h1>

      {examsQuery.isLoading ? (
        <Skeleton className="h-10 w-64" />
      ) : examsQuery.isError ? (
        <ErrorState
          message={t('resultsRoute.loadError')}
          onRetry={() => void examsQuery.refetch()}
        />
      ) : (
        <>
          <Select value={selectedExamId ?? ''} onValueChange={setExamId}>
            <SelectTrigger aria-label={t('resultsRoute.examLabel')}>
              <SelectValue placeholder={t('resultsRoute.examPlaceholder')} />
            </SelectTrigger>
            <SelectContent>
              {exams.map((exam) => (
                <SelectItem key={exam.id} value={exam.id}>
                  {exam.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {!selectedExam ? (
            <p className="text-sm text-muted-foreground">{t('resultsRoute.selectExamHint')}</p>
          ) : (
            <ResultsPanel examId={selectedExam.id} examStatus={selectedExam.status} />
          )}
        </>
      )}
    </div>
  );
}

function ResultsListPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="list" label={t('routePending.label', { ns: 'nav' })} />;
}
