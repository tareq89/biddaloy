/**
 * [19.8.1] Results landing page — the palette's navigate target for
 * Process/Publish/Send-SMS (`action-registry.ts`'s `ActionRunContext`
 * carries no entity id, same "lands on the list, not a specific record"
 * pattern `grading.copyScale` already uses). Pick an exam, get the same
 * `ResultsPanel` the exam detail's Results tab renders — one component,
 * two entry points, no second copy of the table/dialogs.
 *
 * [31.4.marks-2] Kit header, labelled picker and the exam's status with a
 * one-line next step above the panel.
 */
import {
  EmptyState,
  ErrorState,
  Label,
  RoutePending,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  StatusBadge,
} from '@biddaloy/ui/components';
import { examsQueryOptions, useExams } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { PageContainer, PageHeader } from '@biddaloy/ui/shells';
import { createFileRoute } from '@tanstack/react-router';
import { FilePenLineIcon } from 'lucide-react';
import * as React from 'react';

import { loadRouteNamespaces, swallowUnlessOffline } from '../../../route-loaders';
import { ResultsPanel } from '../exams/-detail/results-panel';

export const Route = createFileRoute('/_staff/results/')({
  loader: ({ context: { queryClient } }) =>
    Promise.all([
      queryClient.ensureQueryData(examsQueryOptions({})).catch(swallowUnlessOffline),
      loadRouteNamespaces('exams', 'grading', 'common'),
    ]),
  pendingComponent: ResultsListPending,
  component: ResultsListPage,
});

const TONE = { DRAFT: 'neutral', PROCESSED: 'info', PUBLISHED: 'success' } as const;

function ResultsListPage() {
  const { t } = useTranslation('exams');
  const { t: tg } = useTranslation('grading');
  const examsQuery = useExams({ limit: 50 });
  const exams = examsQuery.data?.data ?? [];
  const [examId, setExamId] = React.useState<string | undefined>(undefined);
  const selectedExamId = examId ?? exams[0]?.id;
  const selectedExam = exams.find((exam) => exam.id === selectedExamId);

  return (
    <PageContainer>
      <PageHeader title={t('resultsRoute.title')} subtitle={tg('resultsPage.subtitle')} />

      {examsQuery.isLoading ? (
        <Skeleton className="h-11 w-full md:h-8 md:w-96" />
      ) : examsQuery.isError ? (
        <ErrorState
          message={t('resultsRoute.loadError')}
          onRetry={() => void examsQuery.refetch()}
        />
      ) : exams.length === 0 ? (
        <EmptyState
          icon={<FilePenLineIcon />}
          title={tg('marksEntry.noExamsTitle')}
          explanation={tg('marksEntry.noExamsText')}
        />
      ) : (
        <>
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:gap-4">
            <div className="flex flex-col gap-1.5 md:w-96 md:shrink-0">
              <Label htmlFor="results-exam">{t('resultsRoute.examLabel')}</Label>
              <Select value={selectedExamId ?? ''} onValueChange={setExamId}>
                <SelectTrigger id="results-exam" className="w-full">
                  <SelectValue placeholder={t('resultsRoute.examPlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  {exams.map((exam) => (
                    <SelectItem key={exam.id} value={exam.id}>
                      {exam.class?.name
                        ? tg('marksEntry.examOption', { exam: exam.name, class: exam.class.name })
                        : exam.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {selectedExam && (
              <div className="flex min-w-0 items-start gap-2 md:min-h-8 md:items-center">
                <StatusBadge
                  tone={TONE[selectedExam.status]}
                  label={t(`status.${selectedExam.status}`)}
                />
                <p className="text-text-secondary">
                  {tg(`resultsPage.nextStep.${selectedExam.status}`)}
                </p>
              </div>
            )}
          </div>

          {!selectedExam ? (
            <p className="text-text-secondary">{t('resultsRoute.selectExamHint')}</p>
          ) : (
            <ResultsPanel examId={selectedExam.id} examStatus={selectedExam.status} />
          )}
        </>
      )}
    </PageContainer>
  );
}

function ResultsListPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="list" label={t('routePending.label', { ns: 'nav' })} />;
}
