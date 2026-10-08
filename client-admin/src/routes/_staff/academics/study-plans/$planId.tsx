/**
 * [66.2] Study-plan detail: `DetailShell` header (facts, behind badge) and the
 * ordered lessons table. Dates and the behind count come from
 * `GET /study-plans/:id/schedule`; nothing date-related is computed here.
 * Header actions (extra class, CSV, More menu and their dialogs) are 3-07.
 */
import { Permission, UserRole } from '@biddaloy/shared';
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
  downloadStudyPlanLessonsCsv,
  studyPlanQueryOptions,
  useActiveRole,
  useDeleteStudyPlan,
  useHasPermission,
  useStudyPlan,
  useStudyPlanSchedule,
  useSyllabusTopicList,
  type StudyPlanLesson,
} from '@biddaloy/ui/hooks';
import { RegionConfigProvider, useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { DetailShell, type DetailShellAction } from '@biddaloy/ui/shells';
import { formatDateRange, formatNumber } from '@biddaloy/ui/utils';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import {
  CalendarPlus,
  Copy,
  Download,
  Flag,
  Library,
  ListOrdered,
  Plus,
  Trash2,
  UserRoundCog,
} from 'lucide-react';
import * as React from 'react';

import { loadRouteNamespaces, swallowUnlessOffline } from '../../../../route-loaders';
import { subjectName } from '../homework/-subject-name';

import { errorCode } from './-detail/action-errors';
import { AddToLibraryDialog } from './-detail/add-to-library-dialog';
import { ChangeOwnerDialog } from './-detail/change-owner-dialog';
import { CopyToSectionDialog } from './-detail/copy-to-section-dialog';
import { ExamMarkersDialog } from './-detail/exam-markers-dialog';
import { ExtraClassDialog } from './-detail/extra-class-dialog';
import { LessonFormDialog } from './-detail/lesson-form-dialog';
import { LessonsTable } from './-detail/lessons-table';
import { studyPlanTitle } from './-detail/plan-title';
import { useSaveLessons } from './-detail/use-save-lessons';

export const Route = createFileRoute('/_staff/academics/study-plans/$planId')({
  loader: ({ context: { queryClient }, params }) =>
    Promise.all([
      queryClient.ensureQueryData(studyPlanQueryOptions(params.planId)).catch(swallowUnlessOffline),
      loadRouteNamespaces('studyPlans', 'syllabus', 'routines', 'common'),
    ]),
  pendingComponent: StudyPlanDetailPending,
  component: StudyPlanDetailPage,
});

type PlanDialog = 'extra' | 'copy' | 'markers' | 'owner' | 'library' | 'delete';

function StudyPlanDetailPage() {
  const { planId } = Route.useParams();
  const { t, i18n } = useTranslation('studyPlans');
  const { t: tCommon } = useTranslation('common');
  const regionConfig = useTenantRegionConfig();
  const canManage = useHasPermission(Permission.SYLLABUS_MANAGE);
  const canReadRoutine = useHasPermission(Permission.ROUTINE_READ);
  const canManageTemplates = useHasPermission(Permission.STUDY_PLAN_TEMPLATE_MANAGE);
  const isAdmin = useActiveRole() === UserRole.ADMIN;
  const navigate = useNavigate();
  const deletePlan = useDeleteStudyPlan();
  const [dialog, setDialog] = React.useState<PlanDialog | null>(null);
  const [markerExamId, setMarkerExamId] = React.useState<string | undefined>(undefined);
  const [actionError, setActionError] = React.useState<string | null>(null);

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

  const busy = isPending || deletePlan.isPending;
  const open = (next: PlanDialog) => {
    if (busy) return;
    setActionError(null);
    setDialog(next);
  };
  const actions: DetailShellAction[] = [
    {
      id: 'extra-class',
      label: t('actions.extraClass'),
      icon: <CalendarPlus />,
      onClick: () => open('extra'),
      allowed: editable,
      keepOnPhone: true,
    },
    {
      id: 'download-csv',
      label: t('actions.downloadCsv'),
      icon: <Download />,
      onClick: () => void downloadStudyPlanLessonsCsv(planId),
    },
    {
      id: 'add-lesson',
      label: t('detail.addLesson'),
      icon: <Plus />,
      onClick: () => !busy && setForm({}),
      allowed: editable,
      priority: 'primary',
    },
    {
      id: 'copy',
      label: t('actions.copyToSection'),
      icon: <Copy />,
      onClick: () => open('copy'),
      allowed: editable,
      priority: 'tertiary',
    },
    {
      id: 'add-to-library',
      label: t('actions.addToLibrary'),
      icon: <Library />,
      onClick: () => open('library'),
      allowed: canManageTemplates,
      priority: 'tertiary',
    },
    {
      id: 'exam-marker',
      label: t('actions.examMarker'),
      icon: <Flag />,
      onClick: () => {
        setMarkerExamId(undefined);
        open('markers');
      },
      allowed: editable,
      priority: 'tertiary',
    },
    {
      id: 'change-owner',
      label: t('actions.changeOwner'),
      icon: <UserRoundCog />,
      onClick: () => open('owner'),
      allowed: isAdmin,
      priority: 'tertiary',
    },
    {
      id: 'delete-plan',
      label: t('actions.deletePlan'),
      icon: <Trash2 />,
      onClick: () => open('delete'),
      allowed: editable,
      priority: 'destructive',
    },
  ];

  function handleDeletePlan() {
    setActionError(null);
    deletePlan.mutate(planId, {
      onSuccess: () => {
        setDialog(null);
        void navigate({ href: '/academics/syllabus?tab=plans' });
      },
      onError: (error) => {
        setDialog(null);
        setActionError(
          errorCode(error) === 'STUDY_PLAN_OUT_OF_SCOPE'
            ? t('detail.notYourPlan')
            : tCommon('status.error'),
        );
      },
    });
  }

  const closeDialog = (next: boolean) => !next && setDialog(null);

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
        {actionError && (
          <p role="alert" className="rounded-md bg-muted px-4 py-3 text-destructive">
            {actionError}
          </p>
        )}
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
              {...(editable
                ? {
                    onEditMarker: (marker) => {
                      setMarkerExamId(marker.exam_id);
                      open('markers');
                    },
                  }
                : {})}
            />
          )}
        </DetailShell>

        {editable && (
          <>
            <ExtraClassDialog open={dialog === 'extra'} onOpenChange={closeDialog} plan={plan} />
            <CopyToSectionDialog open={dialog === 'copy'} onOpenChange={closeDialog} plan={plan} />
            <ExamMarkersDialog
              open={dialog === 'markers'}
              onOpenChange={closeDialog}
              plan={plan}
              initialExamId={markerExamId}
            />
            <ConfirmDialog
              open={dialog === 'delete'}
              onOpenChange={(next) => !next && !deletePlan.isPending && setDialog(null)}
              title={t('actions.deletePlan')}
              description={t('actions.deleteConfirm', { name })}
              confirmLabel={t('actions.deletePlan')}
              busy={deletePlan.isPending}
              onConfirm={handleDeletePlan}
            />
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
        {canManageTemplates && (
          <AddToLibraryDialog
            open={dialog === 'library'}
            onOpenChange={closeDialog}
            plan={plan}
            defaultName={`${subjectName(plan.subject, i18n.language)} ${plan.section.class_name} — ${plan.term?.name ?? t('list.filters.wholeYear')}`}
          />
        )}
        {isAdmin && (
          <ChangeOwnerDialog open={dialog === 'owner'} onOpenChange={closeDialog} plan={plan} />
        )}
      </div>
    </RegionConfigProvider>
  );
}

function StudyPlanDetailPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="detail" label={t('routePending.label', { ns: 'nav' })} />;
}
