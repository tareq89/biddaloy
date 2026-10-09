/**
 * Exam detail — [19.6.1], redesigned in [31.4.exams-2a]. Header: name, status
 * badge, facts (class, year, type, published date) and the one next-step action
 * for the exam's status. Tabs: Progress (default — the exam controller's daily
 * screen), Marks breakdown, Schedule, Results.
 */
import { Permission } from '@biddaloy/shared';
import { ErrorState, RoutePending, Skeleton } from '@biddaloy/ui/components';
import {
  examQueryOptions,
  useAcademicYear,
  useClass,
  useExam,
  useHasPermission,
} from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { DetailShell, useDetailShellTab } from '@biddaloy/ui/shells';
import { formatDate } from '@biddaloy/ui/utils';
import { createFileRoute } from '@tanstack/react-router';
import { Pencil } from 'lucide-react';
import * as React from 'react';
import { z } from 'zod';

import { loadRouteNamespaces, swallowUnlessOffline } from '../../../route-loaders';

import { ComponentsPanel } from './-detail/components-panel';
import { ProgressPanel } from './-detail/progress-panel';
import { ResultsPanel } from './-detail/results-panel';
import { SchedulePanel } from './-detail/schedule-panel';
import { useResultActions } from './-detail/use-result-actions';
import { ExamFormDialog } from './-exam-form-dialog';
import { ExamStatusBadge } from './-exam-status-badge';

// `tab` must be declared or `validateSearch` strips it; `copy=1` opens the copy-parts tool.
const examDetailSearchSchema = z.object({
  tab: z.string().optional().catch(undefined),
  copy: z.coerce.string().optional().catch(undefined),
});

export const Route = createFileRoute('/_staff/exams/$examId')({
  validateSearch: examDetailSearchSchema,
  loader: ({ context: { queryClient }, params }) =>
    Promise.all([
      queryClient.ensureQueryData(examQueryOptions(params.examId)).catch(swallowUnlessOffline),
      loadRouteNamespaces('exams', 'common', 'examsTemplateField', 'grading'),
    ]),
  pendingComponent: ExamDetailPending,
  component: ExamDetailPage,
});

const TAB_IDS = ['progress', 'setup', 'schedule', 'results'] as const;

function ExamDetailPage() {
  const { examId } = Route.useParams();
  const { t } = useTranslation('exams');
  const config = useRegionConfig();
  const examQuery = useExam(examId);
  const exam = examQuery.data;
  const classQuery = useClass(exam?.class_id);
  const yearQuery = useAcademicYear(exam?.academic_year_id);
  const canManage = useHasPermission(Permission.EXAM_MANAGE);
  const resultActions = useResultActions(examId, exam?.status);
  const [activeTab, setActiveTab] = useDetailShellTab(TAB_IDS);
  const [editOpen, setEditOpen] = React.useState(false);

  if (examQuery.isPending) return <ExamHeaderSkeleton />;
  if (examQuery.isError || !exam) {
    return (
      <ErrorState message={t('detail.loadError')} onRetry={() => void examQuery.refetch()} />
    );
  }

  // A fact still loading shows a bar, never the id.
  const lookup = (name: string | undefined, loading: boolean) =>
    name ?? (loading ? <Skeleton className="h-3 w-16" /> : '—');

  return (
    <>
      <DetailShell
        name={exam.name}
        statusBadge={<ExamStatusBadge status={exam.status} />}
        facts={[
          {
            label: t('detail.facts.class'),
            value: lookup(classQuery.data?.name, classQuery.isLoading),
          },
          {
            label: t('detail.facts.academicYear'),
            value: lookup(yearQuery.data?.name, yearQuery.isLoading),
          },
          { label: t('detail.facts.kind'), value: t(`kind.${exam.kind}`) },
          ...(exam.published_at
            ? [
                {
                  label: t('detail.facts.publishedAt'),
                  value: formatDate(exam.published_at, config),
                },
              ]
            : []),
        ]}
        actions={[
          // A lone destructive action stays inline in PageHeader; without the edit item (no
          // EXAM_MANAGE) Reopen would be a red inline button, so it goes to More as a plain item.
          ...resultActions.actions.map((a) =>
            !canManage && a.priority === 'destructive' ? { ...a, priority: 'tertiary' as const } : a,
          ),
          {
            id: 'edit',
            label: t('detail.edit'),
            icon: <Pencil aria-hidden className="size-4" />,
            priority: 'tertiary',
            allowed: canManage,
            onClick: () => setEditOpen(true),
          },
        ]}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        tabs={[
          {
            id: 'progress',
            label: t('detail.tabs.progress'),
            content: <ProgressPanel examId={examId} onGoToSetup={() => setActiveTab('setup')} />,
          },
          {
            id: 'setup',
            label: t('detail.tabs.setup'),
            content: (
              <ComponentsPanel
                examId={examId}
                classId={exam.class_id}
                academicYearId={exam.academic_year_id}
              />
            ),
          },
          {
            id: 'schedule',
            label: t('detail.tabs.schedule'),
            content: (
              <SchedulePanel
                examId={examId}
                classId={exam.class_id}
                academicYearId={exam.academic_year_id}
              />
            ),
          },
          {
            id: 'results',
            label: t('detail.tabs.results'),
            // No `examStatus`: the header already holds the actions.
            content: <ResultsPanel examId={examId} />,
          },
        ]}
      />
      {resultActions.dialogs}
      {canManage && (
        <ExamFormDialog
          open={editOpen}
          onOpenChange={setEditOpen}
          mode="edit"
          examId={examId}
          initialValues={{ name: exam.name, kind: exam.kind }}
          onSaved={() => setEditOpen(false)}
        />
      )}
    </>
  );
}

function ExamHeaderSkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-busy="true">
      <div className="h-7 w-64 rounded-sm bg-muted" />
      <div className="flex gap-6">
        <div className="h-3 w-24 rounded-sm bg-muted" />
        <div className="h-3 w-24 rounded-sm bg-muted" />
        <div className="h-3 w-24 rounded-sm bg-muted" />
      </div>
    </div>
  );
}

function ExamDetailPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="detail" label={t('routePending.label', { ns: 'nav' })} />;
}
