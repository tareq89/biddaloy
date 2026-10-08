/**
 * [66.2] Study-plan detail: `DetailShell` header (facts, behind badge) and the
 * ordered lessons table. Dates and the behind count come from
 * `GET /study-plans/:id/schedule`; nothing date-related is computed here.
 * Secondary actions (extra class, CSV, More menu) are 3-07: `extraActions`
 * is the slot they fill.
 */
import { Permission } from '@biddaloy/shared';
import { ApiError } from '@biddaloy/ui/api';
import {
  ConfirmDialog,
  EmptyState,
  ErrorState,
  ProgressBar,
  RoutePending,
  Skeleton,
  StatusBadge,
} from '@biddaloy/ui/components';
import {
  studyPlanQueryOptions,
  useHasPermission,
  useStudyPlan,
  useStudyPlanSchedule,
  useSyllabusTopicList,
  type StudyPlanLesson,
} from '@biddaloy/ui/hooks';
import { RegionConfigProvider, useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { DetailShell, type DetailShellAction } from '@biddaloy/ui/shells';
import { formatDateRange, formatNumber } from '@biddaloy/ui/utils';
import { createFileRoute, Link } from '@tanstack/react-router';
import { ListOrdered, Plus } from 'lucide-react';
import * as React from 'react';

import { loadRouteNamespaces, swallowUnlessOffline } from '../../../../route-loaders';

import { LessonFormDialog } from './-detail/lesson-form-dialog';
import { LessonsTable } from './-detail/lessons-table';
import { studyPlanTitle } from './-detail/plan-title';
import { useSaveLessons } from './-detail/use-save-lessons';

export const Route = createFileRoute('/_staff/academics/study-plans/$planId')({
  loader: ({ context: { queryClient }, params }) =>
    Promise.all([
      queryClient.ensureQueryData(studyPlanQueryOptions(params.planId)).catch(swallowUnlessOffline),
      loadRouteNamespaces('studyPlans', 'syllabus', 'common'),
    ]),
  pendingComponent: StudyPlanDetailPending,
  component: StudyPlanDetailPage,
});

/** 3-07 fills this slot (extra class, CSV, More menu). */
const EXTRA_ACTIONS: DetailShellAction[] = [];

function StudyPlanDetailPage() {
  const { planId } = Route.useParams();
  const { t, i18n } = useTranslation('studyPlans');
  const { t: tCommon } = useTranslation('common');
  const regionConfig = useTenantRegionConfig();
  const canManage = useHasPermission(Permission.SYLLABUS_MANAGE);
  const canReadRoutine = useHasPermission(Permission.ROUTINE_READ);

  const planQuery = useStudyPlan(planId);
  const scheduleQuery = useStudyPlanSchedule(planId);
  const plan = planQuery.data;
  const schedule = scheduleQuery.data;
  const topicsQuery = useSyllabusTopicList(
    { class_id: plan?.section.class_id ?? '', subject_id: plan?.subject.id ?? '' },
    { enabled: plan !== undefined },
  );
  const topics = topicsQuery.data ?? [];

  const { save, isPending } = useSaveLessons(planId);
  const [form, setForm] = React.useState<{ lesson?: StudyPlanLesson } | null>(null);
  const [deleting, setDeleting] = React.useState<{ lesson: StudyPlanLesson; index: number } | null>(
    null,
  );

  if (planQuery.isPending) {
    return (
      <div className="flex flex-col gap-2" aria-hidden="true">
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (planQuery.isError || plan === undefined) {
    const forbidden = planQuery.error instanceof ApiError && planQuery.error.statusCode === 403;
    return (
      <ErrorState
        message={forbidden ? t('detail.forbidden') : t('detail.notFound')}
        retryLabel={tCommon('actions.retry')}
        onRetry={() => void planQuery.refetch()}
      />
    );
  }

  const editable = canManage && plan.can_edit;
  const num = (n: number) => formatNumber(n, regionConfig);
  const name = studyPlanTitle(plan, i18n.language, t('list.filters.wholeYear'));
  const summary = schedule?.summary;

  function behindBadge() {
    if (!summary) return undefined;
    if (summary.periods_behind <= 0) {
      return <StatusBadge tone="success" label={t('list.onTrack')} />;
    }
    return (
      <StatusBadge
        tone={summary.lessons_behind >= 1 ? 'danger' : 'warning'}
        label={t('list.behindBy', {
          periods: num(summary.periods_behind),
          lessons: num(summary.lessons_behind),
        })}
      />
    );
  }

  const capacity = summary?.capacity;
  const facts = [
    {
      label: t('detail.owner'),
      value: plan.owners.map((owner) => owner.full_name).join(', ') || '—',
    },
    {
      label: t('detail.term'),
      value: schedule ? formatDateRange(schedule.range.from, schedule.range.to, regionConfig) : '—',
    },
    {
      label: t('detail.progress'),
      value: summary ? (
        <ProgressBar
          done={summary.lessons_done}
          total={summary.lessons_total}
          label={t('list.lessonsDone', {
            done: num(summary.lessons_done),
            total: num(summary.lessons_total),
          })}
        />
      ) : (
        '—'
      ),
    },
    {
      label: t('detail.periodsLeft'),
      value: capacity ? (
        <span className={capacity.fits ? '' : 'text-status-due-fg'}>
          {t('detail.capacity', {
            left: num(capacity.periods_left),
            needed: num(capacity.periods_needed),
          })}
        </span>
      ) : (
        '—'
      ),
    },
  ];

  const actions: DetailShellAction[] = [
    {
      id: 'add-lesson',
      label: t('detail.addLesson'),
      icon: <Plus />,
      onClick: () => !isPending && setForm({}),
      allowed: editable,
      priority: 'primary',
    },
    ...EXTRA_ACTIONS,
  ];

  const current = plan.lessons;
  function handleSubmit(lesson: StudyPlanLesson) {
    const next = form?.lesson
      ? current.map((l) => (l.id === lesson.id ? lesson : l))
      : [...current, lesson];
    save(next, { onSuccess: () => setForm(null) });
  }

  function handleDelete() {
    if (!deleting) return;
    save(
      current.filter((l) => l.id !== deleting.lesson.id),
      { onSuccess: () => setDeleting(null), onError: () => setDeleting(null) },
    );
  }

  return (
    <RegionConfigProvider value={regionConfig}>
      <div className="flex flex-col gap-4">
        <DetailShell name={name} statusBadge={behindBadge()} facts={facts} actions={actions}>
          {summary?.routine_missing && (
            <p className="mb-4 rounded-md bg-muted px-4 py-3 text-text-secondary">
              {t('detail.noRoutine')}{' '}
              {canReadRoutine && (
                <Link to="/routines" className="text-primary underline">
                  {t('detail.openRoutines')}
                </Link>
              )}
            </p>
          )}

          {plan.lessons.length === 0 ? (
            <EmptyState
              icon={<ListOrdered />}
              title={t('detail.emptyTitle')}
              explanation={t('list.emptyExplanation')}
              {...(editable
                ? { action: { label: t('detail.addLesson'), onClick: () => setForm({}) } }
                : {})}
            />
          ) : (
            <LessonsTable
              save={save}
              isPending={isPending}
              lessons={plan.lessons}
              schedule={schedule}
              topics={topics}
              examMarkers={plan.exam_markers}
              editable={editable}
              onEdit={(lesson) => setForm({ lesson })}
              onDelete={(lesson, index) => setDeleting({ lesson, index })}
            />
          )}
        </DetailShell>

        {editable && (
          <>
            <LessonFormDialog
              open={form !== null}
              onOpenChange={(open) => !open && !isPending && setForm(null)}
              lesson={form?.lesson}
              topics={topics}
              isPending={isPending}
              onSubmit={handleSubmit}
            />
            <ConfirmDialog
              open={deleting !== null}
              onOpenChange={(open) => !open && !isPending && setDeleting(null)}
              title={t('lesson.delete')}
              description={
                deleting
                  ? t('lesson.deleteConfirm', {
                      no: num(deleting.index + 1),
                      title: deleting.lesson.title,
                    })
                  : ''
              }
              confirmLabel={t('lesson.delete')}
              busy={isPending}
              onConfirm={handleDelete}
            />
          </>
        )}
      </div>
    </RegionConfigProvider>
  );
}

function StudyPlanDetailPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="detail" label={t('routePending.label', { ns: 'nav' })} />;
}
