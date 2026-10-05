/**
 * [22.4.1] Homework detail. No assignments table, no Reassign/Deactivate
 * button, no submission grid — those are blocked on the follow-up server
 * ticket drafted in the plan (`GET /homework/:id/assignments` doesn't
 * exist yet). This page shows the Homework row and lets a staff member
 * assign it to another section or student via `POST /homework/:id/assign`.
 */
import { Permission } from '@biddaloy/shared';
import { ApiError, captureNotificationTenant, notifyOutcome } from '@biddaloy/ui/api';
import {
  Card,
  Dialog,
  DialogContent,
  DialogDescription,
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
import { RegionConfigProvider, useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { DetailShell } from '@biddaloy/ui/shells';
import { formatDate, parseServerDate } from '@biddaloy/ui/utils';
import { createFileRoute } from '@tanstack/react-router';
import { Send } from 'lucide-react';
import * as React from 'react';

import { loadRouteNamespaces, swallowUnlessOffline } from '../../../../route-loaders';

import { AssignHomeworkForm, type AssignHomeworkFormSubmitPayload } from './-assign-homework-form';
import { subjectName } from './-subject-name';

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
  const { t, i18n } = useTranslation('homework');
  const { t: tCommon } = useTranslation('common');

  const homeworkQuery = useHomework(homeworkId);
  const canAssign = useHasPermission(Permission.HOMEWORK_ASSIGN);
  const regionConfig = useTenantRegionConfig();

  const homework = homeworkQuery.data;
  const classQuery = useClass(homework?.class_id);
  const subjectsQuery = useSubjects({ limit: 100 });

  const [assignOpen, setAssignOpen] = React.useState(false);
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

  const subject = subjectsQuery.data?.data.find((s) => s.id === homework.subject_id);

  function handleAssign(payload: AssignHomeworkFormSubmitPayload) {
    assignHomework.mutate(
      { homeworkId, input: payload.assignment },
      {
        onSuccess: (assignment) => {
          setAssignOpen(false);
          notifyOutcome({
            tenantId: captureNotificationTenant(),
            variant: 'success',
            message: t('detail.assigned', {
              date: formatDate(parseServerDate(assignment.due_date), regionConfig),
            }),
          });
        },
      },
    );
  }

  return (
    <RegionConfigProvider value={regionConfig}>
      <div className="flex flex-col gap-4">
        <DetailShell
          name={homework.title}
          facts={[
            { label: t('detail.subjectLabel'), value: subjectName(subject, i18n.language) },
            { label: t('detail.classLabel'), value: classQuery.data?.name ?? '—' },
            {
              label: t('detail.gradingModeLabel'),
              value: t(`form.gradingMode.${homework.grading_mode}`),
            },
            {
              label: t('detail.createdLabel'),
              value: formatDate(parseServerDate(homework.created_at), regionConfig),
            },
          ]}
          actions={[
            {
              id: 'assign',
              label: t('detail.assignAgain'),
              icon: <Send />,
              onClick: () => setAssignOpen(true),
              allowed: canAssign,
              priority: 'primary',
            },
          ]}
        />

        <Card padded>
          <h2 className="text-h2">{t('detail.descriptionLabel')}</h2>
          <p
            className={
              homework.description
                ? 'mt-2 whitespace-pre-line'
                : 'mt-2 whitespace-pre-line text-text-secondary'
            }
          >
            {homework.description || t('detail.noDescription')}
          </p>
        </Card>

        {canAssign && (
          <Dialog
            open={assignOpen}
            onOpenChange={(open) => {
              if (!assignHomework.isPending) setAssignOpen(open);
            }}
          >
            <DialogContent size="md" closeLabel={tCommon('actions.close')}>
              <DialogHeader>
                <DialogTitle>{t('detail.assignAgain')}</DialogTitle>
                <DialogDescription>
                  {t('detail.assignDescription', {
                    title: homework.title,
                    className: classQuery.data?.name ?? '—',
                  })}
                </DialogDescription>
              </DialogHeader>
              <AssignHomeworkForm
                mode="assign"
                initial={{ classId: homework.class_id }}
                isPending={assignHomework.isPending}
                {...(assignHomework.isError ? { error: t('form.genericError') } : {})}
                onSubmit={handleAssign}
              />
            </DialogContent>
          </Dialog>
        )}
      </div>
    </RegionConfigProvider>
  );
}

function HomeworkDetailPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="detail" label={t('routePending.label', { ns: 'nav' })} />;
}
