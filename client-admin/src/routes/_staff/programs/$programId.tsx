/**
 * Program detail — [34.4.1]. Clone of `classes/$classId.tsx`'s
 * `DetailShell` + `useDetailShellTab` shape. `?enrol=1`/`?record=1` (the
 * same D10 palette contract `index.tsx` documents) open the matching
 * dialog directly on this page too.
 */
import { Permission } from '@biddaloy/shared';
import { ApiError } from '@biddaloy/ui/api';
import { ErrorState, RoutePending, Skeleton } from '@biddaloy/ui/components';
import { programQueryOptions, useHasPermission, useProgram } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { DetailShell, useDetailShellTab } from '@biddaloy/ui/shells';
import { createFileRoute } from '@tanstack/react-router';
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

  const [editOpen, setEditOpen] = React.useState(false);

  function closeDialogSearch() {
    void navigate({ search: { enrol: undefined, record: undefined, student: undefined } });
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

  return (
    <div className="flex flex-col gap-4">
      <DetailShell
        name={program.name}
        identifiers={
          <>
            {t('list.columns.activeStudents')}: {program.active_enrollment_count ?? 0}
            {' · '}
            {t('list.columns.milestones')}: {milestoneTotal}
            {!program.is_active && (
              <>
                {' · '}
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium">
                  {t('detail.archivedBadge')}
                </span>
              </>
            )}
          </>
        }
        actions={[
          {
            id: 'edit',
            label: t('formDialog.editTitle'),
            onClick: () => setEditOpen(true),
            allowed: canManage,
            priority: 'primary',
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
              />
            ),
          },
        ]}
        activeTab={activeTab}
        onTabChange={setActiveTab}
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
          onRecorded={closeDialogSearch}
        />
      )}
    </div>
  );
}

function ProgramDetailPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="detail" label={t('routePending.label', { ns: 'nav' })} />;
}
