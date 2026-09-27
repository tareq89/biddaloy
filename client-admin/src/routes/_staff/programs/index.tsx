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
import { Button, type DataTableColumn } from '@biddaloy/ui/components';
import {
  programsQueryOptions,
  useHasPermission,
  usePrograms,
  type Program,
} from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { ListShell, useListShellState, type FilterFieldDescriptor } from '@biddaloy/ui/shells';
import { createFileRoute, Link } from '@tanstack/react-router';
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
  const [state, actions] = useListShellState({ limit: 25 });
  const canManage = useHasPermission(Permission.PROGRAM_MANAGE);

  const includeArchived = state.filters.archived === 'true';
  const programsQuery = usePrograms({ includeArchived });
  const programs = includeArchived
    ? (programsQuery.data ?? [])
    : (programsQuery.data ?? []).filter((program) => program.is_active);

  const filterFields: FilterFieldDescriptor[] = [
    { kind: 'checkbox', key: 'archived', label: t('list.showArchived') },
  ];

  const columns: DataTableColumn<Program>[] = [
    {
      id: 'name',
      header: t('list.columns.name'),
      accessorFn: (row) => (
        <Link
          to="/programs/$programId"
          params={{ programId: row.id }}
          className="font-medium text-primary underline"
        >
          {row.name}
        </Link>
      ),
    },
    {
      id: 'milestones',
      header: t('list.columns.milestones'),
      accessorFn: (row) => row.milestone_count ?? 0,
      align: 'end',
    },
    {
      id: 'activeStudents',
      header: t('list.columns.activeStudents'),
      accessorFn: (row) => row.active_enrollment_count ?? 0,
      align: 'end',
    },
    {
      id: 'reportCard',
      header: t('list.columns.reportCard'),
      accessorFn: (row) => (row.show_on_report_card ? '✓' : ''),
    },
  ];

  function closeDialog() {
    void navigate({ search: { ...search, new: undefined, enrol: undefined, record: undefined } });
  }

  return (
    <>
      <ListShell
        title={t('list.title')}
        primaryAction={
          canManage && (
            <Button
              type="button"
              onClick={() => void navigate({ search: { ...search, new: '1' } })}
            >
              {t('actions.add')}
            </Button>
          )
        }
        filters={{ fields: filterFields, values: state.filters, onChange: actions.setFilters }}
        tableId="programs-list"
        caption={t('list.title')}
        columns={columns}
        data={programs}
        getRowId={(row) => row.id}
        sorting={state.sorting}
        onSortingChange={actions.setSorting}
        page={state.page}
        pageSize={state.limit}
        totalCount={programs.length}
        onPageChange={actions.setPage}
        onPageSizeChange={actions.setLimit}
        pageSizeLabel={t('pagination.rowsPerPage', { ns: 'common' })}
        loading={programsQuery.isLoading}
        isFetching={programsQuery.isFetching}
        {...(programsQuery.isError ? { error: t('list.errorMessage', { ns: 'programs' }) } : {})}
        emptyMessage={t('list.empty')}
      />

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
