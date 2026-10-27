/**
 * [22.4.1] Homework detail. Assignment rows come from `GET /homework/:id/assignments`
 * (#1013). "Assign to section or student" only adds a row (`POST /homework/:id/assign`);
 * "Change" on a row reassigns it through `POST /homework-assignments/:id/reassign`.
 * No Deactivate and no submission grid yet (#2900, #2899).
 */
import { Permission } from '@biddaloy/shared';
import {
  ApiError,
  captureNotificationTenant,
  isNotFoundError,
  notifyOutcome,
} from '@biddaloy/ui/api';
import {
  Card,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  ErrorState,
  RecordNotFoundState,
  RoutePending,
  Skeleton,
  type RowAction,
} from '@biddaloy/ui/components';
import {
  useAssignHomework,
  useClass,
  useHasPermission,
  useHomework,
  useHomeworkAssignments,
  homeworkQueryOptions,
  useReassignHomeworkAssignment,
  useSubjects,
  type HomeworkAssignmentListItem,
} from '@biddaloy/ui/hooks';
import { RegionConfigProvider, useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { DetailShell } from '@biddaloy/ui/shells';
import { formatDate, parseServerDate } from '@biddaloy/ui/utils';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { Send } from 'lucide-react';
import * as React from 'react';

import { loadRouteNamespaces, swallowUnlessOffline } from '../../../../route-loaders';

import { AssignHomeworkForm, type AssignHomeworkFormSubmitPayload } from './-assign-homework-form';
import { AssignmentsCard, assignmentTargetLabel } from './-assignments-card';
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
  const navigate = useNavigate();
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
  const assignmentsQuery = useHomeworkAssignments(homeworkId);
  const reassign = useReassignHomeworkAssignment();
  const [reassignRow, setReassignRow] = React.useState<HomeworkAssignmentListItem | null>(null);
  // Double-click guard: `isPending` flips a render late, a ref does not.
  const inFlight = React.useRef(false);

  if (homeworkQuery.isPending) {
    return (
      <div className="flex flex-col gap-2" aria-hidden="true">
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (isNotFoundError(homeworkQuery.error)) {
    return <RecordNotFoundState onBack={() => void navigate({ to: '/academics/homework' })} />;
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

  function actionsFor(row: HomeworkAssignmentListItem): RowAction[] {
    if (!canAssign || row.status === 'SUPERSEDED') return [];
    return [
      {
        intent: 'edit',
        label: t('detail.assignments.reassign', { target: assignmentTargetLabel(row, t) }),
        shortLabel: t('detail.assignments.reassignShort'),
        busy: reassign.isPending && reassignRow?.id === row.id,
        onClick: () => {
          reassign.reset();
          setReassignRow(row);
        },
      },
    ];
  }

  function handleReassign(payload: AssignHomeworkFormSubmitPayload) {
    if (!reassignRow || inFlight.current) return;
    inFlight.current = true;
    reassign.mutate(
      { assignmentId: reassignRow.id, input: payload.assignment },
      {
        onSettled: () => {
          inFlight.current = false;
        },
        onSuccess: (assignment) => {
          setReassignRow(null);
          notifyOutcome({
            tenantId: captureNotificationTenant(),
            variant: 'success',
            message: t('detail.assignments.reassigned', {
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
              onClick: () => {
                assignHomework.reset();
                setAssignOpen(true);
              },
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

        <AssignmentsCard
          assignments={assignmentsQuery.data}
          loading={assignmentsQuery.isPending}
          error={assignmentsQuery.isError}
          onRetry={() => void assignmentsQuery.refetch()}
          actionsFor={actionsFor}
          {...(canAssign
            ? {
                onAssign: () => {
                  assignHomework.reset();
                  setAssignOpen(true);
                },
              }
            : {})}
        />

        {canAssign && (
          <Dialog
            open={assignOpen}
            onOpenChange={(open) => {
              if (assignHomework.isPending) return;
              assignHomework.reset();
              setAssignOpen(open);
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

        {canAssign && (
          <Dialog
            open={reassignRow !== null}
            onOpenChange={(open) => {
              if (reassign.isPending) return;
              reassign.reset();
              if (!open) setReassignRow(null);
            }}
          >
            <DialogContent size="md" closeLabel={tCommon('actions.close')}>
              <DialogHeader>
                <DialogTitle>{t('detail.assignments.reassignTitle')}</DialogTitle>
                <DialogDescription>{t('detail.assignments.reassignDescription')}</DialogDescription>
              </DialogHeader>
              {reassignRow && (
                <AssignHomeworkForm
                  key={reassignRow.id}
                  mode="reassign"
                  initial={{
                    classId: homework.class_id,
                    sectionId: reassignRow.target_section_id,
                    ...(reassignRow.student_id ? { studentId: reassignRow.student_id } : {}),
                    assignedDate: reassignRow.assigned_date,
                    dueDate: reassignRow.due_date,
                  }}
                  isPending={reassign.isPending}
                  {...(reassign.isError ? { error: t('form.genericError') } : {})}
                  onSubmit={handleReassign}
                />
              )}
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
