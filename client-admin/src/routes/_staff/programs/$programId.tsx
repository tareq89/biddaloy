/**
 * Program detail — [34.4.1]. Clone of `classes/$classId.tsx`'s
 * `DetailShell` + `useDetailShellTab` shape. `?enrol=1`/`?record=1` (the
 * same D10 palette contract `index.tsx` documents) open the matching
 * dialog directly on this page too.
 */
import { Permission } from '@biddaloy/shared';
import { ApiError } from '@biddaloy/ui/api';
import {
  ConfirmDialog,
  ErrorState,
  RoutePending,
  Skeleton,
  StatusBadge,
} from '@biddaloy/ui/components';
import {
  programQueryOptions,
  useDeleteProgram,
  useHasPermission,
  useProgram,
  useUpdateProgram,
} from '@biddaloy/ui/hooks';
import { useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { DetailShell, useDetailShellTab } from '@biddaloy/ui/shells';
import { formatNumber } from '@biddaloy/ui/utils';
import { createFileRoute } from '@tanstack/react-router';
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  AwardIcon,
  PencilIcon,
  Trash2Icon,
  UserPlusIcon,
} from 'lucide-react';
import * as React from 'react';
import { z } from 'zod';

import { loadRouteNamespaces, swallowUnlessOffline } from '../../../route-loaders';

import { EnrolDialog } from './-enrol-dialog';
import { MilestoneEditor } from './-milestone-editor';
import { ProgramFormDialog } from './-program-form-dialog';
import { RecordDialog } from './-record-dialog';
import { StudentsTab } from './-students-tab';

const TAB_IDS = ['milestones', 'students'] as const;

const programDetailSearchSchema = z.object({
  enrol: z.coerce.string().optional().catch(undefined),
  record: z.coerce.string().optional().catch(undefined),
  // Sent to the server as an enrolment id when recording — only a real uuid gets through.
  enrollment: z.string().uuid().optional().catch(undefined),
  student: z.coerce.string().optional().catch(undefined),
});

export const Route = createFileRoute('/_staff/programs/$programId')({
  validateSearch: programDetailSearchSchema,
  loader: ({ context: { queryClient }, params }) =>
    Promise.all([
      queryClient
        .ensureQueryData(programQueryOptions(params.programId))
        .catch(swallowUnlessOffline),
      loadRouteNamespaces('programs', 'common'),
    ]),
  pendingComponent: ProgramDetailPending,
  component: ProgramDetailPage,
});

function ProgramDetailPage() {
  const { programId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const { t } = useTranslation('programs');
  const { t: tCommon } = useTranslation('common');

  const programQuery = useProgram(programId);
  const [activeTab, setActiveTab] = useDetailShellTab(TAB_IDS);
  const canManage = useHasPermission(Permission.PROGRAM_MANAGE);
  const canRecord = useHasPermission(Permission.PROGRAM_RECORD) || canManage;
  const regionConfig = useTenantRegionConfig();
  const updateProgram = useUpdateProgram(programId);
  const deleteProgram = useDeleteProgram();

  const [editOpen, setEditOpen] = React.useState(false);
  const [deleteOpen, setDeleteOpen] = React.useState(false);

  function closeDialogSearch() {
    void navigate({
      search: { enrol: undefined, record: undefined, student: undefined, enrollment: undefined },
    });
  }

  if (programQuery.isPending) {
    return (
      <div className="flex flex-col gap-2" aria-hidden="true">
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (programQuery.isError) {
    const forbidden =
      programQuery.error instanceof ApiError && programQuery.error.statusCode === 403;
    return (
      <ErrorState
        message={forbidden ? t('detail.forbidden') : t('list.errorMessage')}
        retryLabel={tCommon('actions.retry')}
        onRetry={() => void programQuery.refetch()}
      />
    );
  }

  const program = programQuery.data;
  const milestoneTotal = program.milestone_count ?? program.milestones?.length ?? 0;

  const deleteConflict =
    deleteProgram.error instanceof ApiError && deleteProgram.error.statusCode === 409;
  const milestoneN = formatNumber(milestoneTotal, regionConfig);
  const studentCount = program.active_enrollment_count ?? 0;

  return (
    <>
      {updateProgram.isError && (
        <p role="alert" className="text-destructive">
          {t('detail.archiveError')}
        </p>
      )}
      <DetailShell
        name={program.name}
        statusBadge={
          <StatusBadge
            tone={program.is_active ? 'success' : 'neutral'}
            label={program.is_active ? t('status.ACTIVE') : t('detail.archivedBadge')}
          />
        }
        facts={[
          {
            label: t('detail.factMilestones'),
            value: t('detail.milestoneCount', { count: milestoneTotal, n: milestoneN }),
          },
          {
            label: t('detail.factActiveStudents'),
            value: t('detail.studentCount', {
              count: studentCount,
              n: formatNumber(studentCount, regionConfig),
            }),
          },
          {
            label: t('detail.factReportCard'),
            value: program.show_on_report_card
              ? t('detail.reportCardShown')
              : t('detail.reportCardHidden'),
          },
        ]}
        actions={[
          {
            id: 'enrol',
            label: t('actions.enrol'),
            icon: <UserPlusIcon />,
            priority: 'secondary',
            allowed: canManage,
            onClick: () => void navigate({ search: { ...search, enrol: '1' } }),
          },
          {
            id: 'record',
            label: t('actions.record'),
            icon: <AwardIcon />,
            priority: 'primary',
            allowed: canRecord,
            onClick: () => void navigate({ search: { ...search, record: '1' } }),
          },
          {
            id: 'edit',
            label: t('formDialog.editTitle'),
            icon: <PencilIcon />,
            priority: 'tertiary',
            allowed: canManage,
            onClick: () => setEditOpen(true),
          },
          {
            id: 'archive',
            label: program.is_active ? t('formDialog.archive') : t('formDialog.unarchive'),
            icon: program.is_active ? <ArchiveIcon /> : <ArchiveRestoreIcon />,
            priority: 'tertiary',
            allowed: canManage,
            busy: updateProgram.isPending,
            onClick: () => updateProgram.mutate({ is_active: !program.is_active }),
          },
          {
            id: 'delete',
            label: t('formDialog.delete'),
            icon: <Trash2Icon />,
            priority: 'destructive',
            allowed: canManage && studentCount === 0,
            onClick: () => {
              deleteProgram.reset();
              setDeleteOpen(true);
            },
          },
        ]}
        tabs={[
          {
            id: 'milestones',
            label: t('detail.tabs.milestones'),
            content: (
              <MilestoneEditor
                programId={program.id}
                milestones={program.milestones ?? []}
                canManage={canManage}
              />
            ),
          },
          {
            id: 'students',
            label: t('detail.tabs.students'),
            content: (
              <StudentsTab
                programId={program.id}
                milestoneTotal={milestoneTotal}
                canManage={canManage}
                onOpenEnrol={() => void navigate({ search: { ...search, enrol: '1' } })}
                onRecordFor={(id) =>
                  void navigate({ search: { ...search, record: '1', enrollment: id } })
                }
              />
            ),
          },
        ]}
        activeTab={activeTab}
        onTabChange={setActiveTab}
      />

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={(o) => !deleteProgram.isPending && setDeleteOpen(o)}
        tone="danger"
        title={t('detail.deleteTitle')}
        description={
          deleteConflict
            ? t('formDialog.deleteConflict')
            : deleteProgram.isError
              ? t('detail.deleteError')
              : t('formDialog.deleteConfirm')
        }
        confirmLabel={t('formDialog.deleteConfirmButton')}
        busy={deleteProgram.isPending}
        onConfirm={() =>
          deleteProgram.mutate(program.id, { onSuccess: () => void navigate({ to: '/programs' }) })
        }
      />

      {canManage && editOpen && (
        <ProgramFormDialog
          open={editOpen}
          onOpenChange={setEditOpen}
          mode="edit"
          program={program}
          onSaved={() => setEditOpen(false)}
        />
      )}

      {search.enrol === '1' && (
        <EnrolDialog
          open
          onOpenChange={closeDialogSearch}
          programId={program.id}
          studentIdPrefill={search.student}
          onEnrolled={closeDialogSearch}
        />
      )}

      {search.record === '1' && (
        <RecordDialog
          open
          onOpenChange={closeDialogSearch}
          programId={program.id}
          enrollmentIdPrefill={search.enrollment}
          onRecorded={closeDialogSearch}
        />
      )}
    </>
  );
}

function ProgramDetailPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="detail" label={t('routePending.label', { ns: 'nav' })} />;
}
