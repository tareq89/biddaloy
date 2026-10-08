/**
 * Programs list — [34.4.1]. Clone of `_staff/grading-scales/index.tsx`'s
 * `ListShell` pattern. `?new=1` / `?enrol=1` / `?record=1` (each optionally
 * paired with `?student=<id>`) open the matching dialog — this is the
 * landing contract 34.4.2's command-palette actions rely on (they only
 * navigate to these URLs, D10), so the search schema has to accept them
 * even though this route never sets them itself except via `new`'s own
 * button.
 */
import { Permission } from '@biddaloy/shared';
import { Button, Checkbox, StatusBadge, type DataTableColumn } from '@biddaloy/ui/components';
import {
  programsQueryOptions,
  useHasPermission,
  usePrograms,
  type Program,
} from '@biddaloy/ui/hooks';
import { useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { ListShell, useListShellState } from '@biddaloy/ui/shells';
import { formatNumber } from '@biddaloy/ui/utils';
import { createFileRoute, Link } from '@tanstack/react-router';
import { MilestoneIcon, PlusIcon } from 'lucide-react';
import * as React from 'react';
import { z } from 'zod';

import { loadRouteNamespaces, swallowUnlessOffline } from '../../../route-loaders';

import { EnrolDialog } from './-enrol-dialog';
import { ProgramFormDialog } from './-program-form-dialog';
import { RecordDialog } from './-record-dialog';

const programsSearchSchema = z.object({
  page: z.number().int().positive().optional().catch(undefined),
  limit: z.number().int().positive().optional().catch(undefined),
  sort: z.string().optional().catch(undefined),
  order: z.enum(['asc', 'desc']).optional().catch(undefined),
  archived: z.coerce.string().optional().catch(undefined),
  selected: z.coerce.string().optional().catch(undefined),
  new: z.coerce.string().optional().catch(undefined),
  enrol: z.coerce.string().optional().catch(undefined),
  record: z.coerce.string().optional().catch(undefined),
  student: z.coerce.string().optional().catch(undefined),
});

export const Route = createFileRoute('/_staff/programs/')({
  validateSearch: programsSearchSchema,
  loader: ({ context: { queryClient } }) =>
    Promise.all([
      queryClient.ensureQueryData(programsQueryOptions({})).catch(swallowUnlessOffline),
      loadRouteNamespaces('programs', 'common'),
    ]),
  component: ProgramsListPage,
});

function ProgramsListPage() {
  const { t } = useTranslation('programs');
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const [state, actions] = useListShellState();
  const canManage = useHasPermission(Permission.PROGRAM_MANAGE);
  const regionConfig = useTenantRegionConfig();
  const [editing, setEditing] = React.useState<Program | null>(null);

  const includeArchived = state.filters.archived === 'true';
  const programsQuery = usePrograms({ includeArchived });
  const programs = includeArchived
    ? (programsQuery.data ?? [])
    : (programsQuery.data ?? []).filter((program) => program.is_active);

  const columns: DataTableColumn<Program>[] = [
    {
      id: 'name',
      header: t('list.columns.name'),
      card: 'title',
      accessorFn: (row) => (
        <>
          <Link
            to="/programs/$programId"
            params={{ programId: row.id }}
            className="inline-flex min-h-11 items-center font-medium text-text-primary hover:text-primary md:min-h-0"
          >
            {row.name}
          </Link>
          {row.description && (
            <span className="hidden truncate text-caption text-text-secondary md:block">
              {row.description}
            </span>
          )}
          <span className="block text-caption text-text-secondary md:hidden">
            {t('list.mobileSummary', {
              milestones: formatNumber(row.milestone_count ?? 0, regionConfig),
              students: formatNumber(row.active_enrollment_count ?? 0, regionConfig),
            })}
          </span>
        </>
      ),
    },
    {
      id: 'milestones',
      header: t('list.columns.milestones'),
      accessorFn: (row) => formatNumber(row.milestone_count ?? 0, regionConfig),
      align: 'end',
      card: 'hidden',
    },
    {
      id: 'activeStudents',
      header: t('list.columns.activeStudents'),
      accessorFn: (row) => formatNumber(row.active_enrollment_count ?? 0, regionConfig),
      align: 'end',
      card: 'hidden',
    },
    {
      id: 'reportCard',
      header: t('list.columns.reportCard'),
      accessorFn: (row) => (row.show_on_report_card ? t('list.yes') : t('list.no')),
      card: 'hidden',
    },
    ...(includeArchived
      ? [
          {
            id: 'status',
            header: t('list.columns.status'),
            card: 'badge' as const,
            accessorFn: (row: Program) => (
              <StatusBadge
                tone={row.is_active ? 'success' : 'neutral'}
                label={row.is_active ? t('status.ACTIVE') : t('detail.archivedBadge')}
              />
            ),
          },
        ]
      : []),
  ];

  function closeDialog() {
    void navigate({ search: { ...search, new: undefined, enrol: undefined, record: undefined } });
  }

  return (
    <>
      <ListShell
        title={t('list.title')}
        subtitle={t('list.subtitle')}
        primaryAction={
          canManage && (
            <Button
              type="button"
              onClick={() => void navigate({ search: { ...search, new: '1' } })}
            >
              <PlusIcon aria-hidden />
              {t('actions.add')}
            </Button>
          )
        }
        filterBar={
          <label className="flex min-h-11 items-center gap-3 md:min-h-8">
            <Checkbox
              checked={includeArchived}
              onCheckedChange={(checked) =>
                actions.setFilters({
                  ...state.filters,
                  archived: checked === true ? 'true' : null,
                })
              }
            />
            {t('list.showArchived')}
          </label>
        }
        tableId="programs-list"
        caption={t('list.title')}
        columns={columns}
        data={programs}
        getRowId={(row) => row.id}
        sorting={state.sorting}
        onSortingChange={actions.setSorting}
        paginated={false}
        totalCount={programs.length}
        rowActions={(row) => [
          { intent: 'view', label: t('list.view'), to: `/programs/${row.id}` },
          {
            intent: 'edit',
            label: t('formDialog.editTitle'),
            allowed: canManage,
            onClick: () => setEditing(row),
          },
        ]}
        loading={programsQuery.isLoading}
        isFetching={programsQuery.isFetching}
        {...(programsQuery.isError ? { error: t('list.errorMessage', { ns: 'programs' }) } : {})}
        emptyState={{
          icon: <MilestoneIcon />,
          title: t('list.empty'),
          explanation: t('list.emptyExplanation'),
          ...(canManage
            ? {
                action: {
                  label: t('actions.add'),
                  onClick: () => void navigate({ search: { ...search, new: '1' } }),
                },
              }
            : {}),
        }}
      />

      {canManage && editing && (
        <ProgramFormDialog
          open
          mode="edit"
          program={editing}
          onOpenChange={(o) => !o && setEditing(null)}
          onSaved={() => setEditing(null)}
        />
      )}

      {canManage && search.new === '1' && (
        <ProgramFormDialog open mode="create" onOpenChange={closeDialog} onSaved={closeDialog} />
      )}

      {canManage && search.enrol === '1' && (
        <EnrolDialog
          open
          onOpenChange={closeDialog}
          programId=""
          studentIdPrefill={search.student}
          onEnrolled={closeDialog}
        />
      )}

      {search.record === '1' && (
        <RecordDialog open onOpenChange={closeDialog} programId="" onRecorded={closeDialog} />
      )}
    </>
  );
}
