/**
 * [22.4.1] Homework detail. No assignments table, no Reassign/Deactivate
 * button, no submission grid — those are blocked on the follow-up server
 * ticket drafted in the plan (`GET /homework/:id/assignments` doesn't
 * exist yet). This page shows the Homework row and lets a staff member
 * assign it to another section or student via `POST /homework/:id/assign`.
 */
import { Permission } from '@biddaloy/shared';
import { ApiError } from '@biddaloy/ui/api';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  ErrorState,
  RoutePending,
  Skeleton,
} from '@biddaloy/ui/components';
import {
  useAssignHomework,
  useClass,
  useHasPermission,
  useHomework,
  homeworkQueryOptions,
  useSubjects,
} from '@biddaloy/ui/hooks';
import { useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { DetailShell } from '@biddaloy/ui/shells';
import { formatDate, parseServerDate } from '@biddaloy/ui/utils';
import { createFileRoute } from '@tanstack/react-router';
import * as React from 'react';

import { loadRouteNamespaces, swallowUnlessOffline } from '../../../../route-loaders';

import { AssignHomeworkForm, type AssignHomeworkFormSubmitPayload } from './-assign-homework-form';

export const Route = createFileRoute('/_staff/academics/homework/$homeworkId')({
  loader: ({ context: { queryClient }, params }) =>
    Promise.all([
      queryClient
        .ensureQueryData(homeworkQueryOptions(params.homeworkId))
        .catch(swallowUnlessOffline),
      loadRouteNamespaces('homework'),
    ]),
  pendingComponent: HomeworkDetailPending,
  component: HomeworkDetailPage,
});

function HomeworkDetailPage() {
  const { homeworkId } = Route.useParams();
  const { t } = useTranslation('homework');
  const { t: tCommon } = useTranslation('common');

  const homeworkQuery = useHomework(homeworkId);
  const canAssign = useHasPermission(Permission.HOMEWORK_ASSIGN);
  const regionConfig = useTenantRegionConfig();

  const homework = homeworkQuery.data;
  const classQuery = useClass(homework?.class_id);
  const subjectsQuery = useSubjects({ limit: 100 });

  const [assignOpen, setAssignOpen] = React.useState(false);
  const [assignedMessage, setAssignedMessage] = React.useState<string | null>(null);
  const assignHomework = useAssignHomework();

  if (homeworkQuery.isPending) {
    return (
      <div className="flex flex-col gap-2" aria-hidden="true">
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (homeworkQuery.isError || homework === undefined) {
    const forbidden =
      homeworkQuery.error instanceof ApiError && homeworkQuery.error.statusCode === 403;
    return (
      <ErrorState
        message={forbidden ? t('detail.forbidden') : t('detail.notFound')}
        retryLabel={tCommon('actions.retry')}
        onRetry={() => void homeworkQuery.refetch()}
      />
    );
  }

  const subjectName = subjectsQuery.data?.data.find((s) => s.id === homework.subject_id)?.name_en;

  function handleAssign(payload: AssignHomeworkFormSubmitPayload) {
    assignHomework.mutate(
      { homeworkId, input: payload.assignment },
      {
        onSuccess: (assignment) => {
          setAssignOpen(false);
          setAssignedMessage(
            t('detail.assigned', {
              date: formatDate(parseServerDate(assignment.due_date), regionConfig),
            }),
          );
        },
      },
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <DetailShell
        name={homework.title}
        identifiers={<>{classQuery.data?.name ?? '—'}</>}
        actions={[
          {
            id: 'assign',
            label: t('detail.assignAgain'),
            onClick: () => setAssignOpen(true),
            allowed: canAssign,
            priority: 'primary',
          },
        ]}
        tabs={[
          {
            id: 'summary',
            label: t('detail.tabSummary'),
            content: (
              <dl className="grid grid-cols-2 gap-4">
                <div>
                  <dt className="text-sm text-muted-foreground">{t('detail.subjectLabel')}</dt>
                  <dd>{subjectName ?? '—'}</dd>
                </div>
                <div>
                  <dt className="text-sm text-muted-foreground">{t('detail.classLabel')}</dt>
                  <dd>{classQuery.data?.name ?? '—'}</dd>
                </div>
                <div>
                  <dt className="text-sm text-muted-foreground">{t('detail.gradingModeLabel')}</dt>
                  <dd>{t(`form.gradingMode.${homework.grading_mode}`)}</dd>
                </div>
                <div>
                  <dt className="text-sm text-muted-foreground">{t('detail.createdLabel')}</dt>
                  <dd>{formatDate(parseServerDate(homework.created_at), regionConfig)}</dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-sm text-muted-foreground">{t('detail.descriptionLabel')}</dt>
                  <dd>{homework.description ?? '—'}</dd>
                </div>
              </dl>
            ),
          },
        ]}
        activeTab="summary"
        onTabChange={() => undefined}
      />

      {assignedMessage !== null && (
        <p role="status" className="text-sm text-primary">
          {assignedMessage}
        </p>
      )}

      {canAssign && (
        <Dialog open={assignOpen} onOpenChange={setAssignOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('detail.assignAgain')}</DialogTitle>
            </DialogHeader>
            <AssignHomeworkForm
              mode="assign"
              initial={{ classId: homework.class_id }}
              isPending={assignHomework.isPending}
              {...(assignHomework.isError
                ? {
                    error:
                      assignHomework.error instanceof ApiError
                        ? assignHomework.error.message
                        : t('form.genericError'),
                  }
                : {})}
              onSubmit={handleAssign}
            />
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

function HomeworkDetailPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="detail" label={t('routePending.label', { ns: 'nav' })} />;
}
