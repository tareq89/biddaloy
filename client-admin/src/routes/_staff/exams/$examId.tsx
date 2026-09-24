/**
 * Exam detail — [19.6.1]. Three tabs: Progress (default — the exam
 * controller's daily screen, issue rule #3/#4), Setup (component
 * configuration), Results (placeholder; 19.8.1 fills it in).
 */
import { ErrorState, RoutePending, Skeleton } from '@biddaloy/ui/components';
import { examQueryOptions, useExam } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { DetailShell, useDetailShellTab } from '@biddaloy/ui/shells';
import { createFileRoute, Link } from '@tanstack/react-router';

import { loadRouteNamespaces, swallowUnlessOffline } from '../../../route-loaders';

import { ComponentsPanel } from './-detail/components-panel';
import { ProgressPanel } from './-detail/progress-panel';
import { ResultsPanel } from './-detail/results-panel';
import { SchedulePanel } from './-detail/schedule-panel';

export const Route = createFileRoute('/_staff/exams/$examId')({
  loader: ({ context: { queryClient }, params }) =>
    Promise.all([
      queryClient.ensureQueryData(examQueryOptions(params.examId)).catch(swallowUnlessOffline),
      loadRouteNamespaces('exams', 'common'),
    ]),
  pendingComponent: ExamDetailPending,
  component: ExamDetailPage,
});

const TAB_IDS = ['progress', 'setup', 'schedule', 'results'] as const;

function ExamDetailPage() {
  const { examId } = Route.useParams();
  const { t } = useTranslation('exams');
  const examQuery = useExam(examId);
  const [activeTab, setActiveTab] = useDetailShellTab(TAB_IDS);

  return (
    <div className="flex flex-col gap-4">
      <Link
        to="/exams"
        className="inline-flex min-h-6 items-center self-start text-sm text-primary underline"
      >
        {t('detail.back')}
      </Link>

      {examQuery.isPending ? (
        <Skeleton className="h-7 w-64" />
      ) : examQuery.isError ? (
        <ErrorState message={t('detail.loadError')} onRetry={() => void examQuery.refetch()} />
      ) : (
        <DetailShell
          name={examQuery.data.name}
          identifiers={t('detail.identifiers', {
            kind: t(`kind.${examQuery.data.kind}`),
            status: t(`status.${examQuery.data.status}`),
          })}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          tabs={[
            {
              id: 'progress',
              label: t('detail.tabs.progress'),
              content: <ProgressPanel examId={examId} />,
            },
            {
              id: 'setup',
              label: t('detail.tabs.setup'),
              content: (
                <ComponentsPanel
                  examId={examId}
                  classId={examQuery.data.class_id}
                  academicYearId={examQuery.data.academic_year_id}
                />
              ),
            },
            {
              id: 'schedule',
              label: t('detail.tabs.schedule'),
              content: (
                <SchedulePanel
                  examId={examId}
                  classId={examQuery.data.class_id}
                  academicYearId={examQuery.data.academic_year_id}
                />
              ),
            },
            {
              id: 'results',
              label: t('detail.tabs.results'),
              content: <ResultsPanel examId={examId} examStatus={examQuery.data.status} />,
            },
          ]}
        />
      )}
    </div>
  );
}

function ExamDetailPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="detail" label={t('routePending.label', { ns: 'nav' })} />;
}
