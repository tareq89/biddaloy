/**
 * [22.4.1] Academics → Homework list. `GET /homework` returns a plain,
 * unpaginated array (`homework.service.ts:66-107`) — see the
 * `// ponytail:` comment below for why this page paginates client-side
 * instead of adding server pagination up front.
 */
import { HomeworkAssignmentStatus, Permission } from '@biddaloy/shared';
import { Button, RoutePending, type DataTableColumn } from '@biddaloy/ui/components';
import {
  homeworkListQueryOptions,
  useClasses,
  useClassSections,
  useHasPermission,
  useHomeworkList,
  useSubjects,
  type Homework,
  type HomeworkListFilters,
} from '@biddaloy/ui/hooks';
import { useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { ListShell, useListShellState, type FilterFieldDescriptor } from '@biddaloy/ui/shells';
import { formatDate, parseServerDate } from '@biddaloy/ui/utils';
import { createFileRoute, Link } from '@tanstack/react-router';
import { z } from 'zod';

import { loadRouteNamespaces, swallowUnlessOffline } from '../../../../route-loaders';

const homeworkSearchSchema = z.object({
  page: z.number().int().positive().optional().catch(undefined),
  limit: z.number().int().positive().optional().catch(undefined),
  class_id: z.string().optional().catch(undefined),
  section_id: z.string().optional().catch(undefined),
  subject_id: z.string().optional().catch(undefined),
  status: z.string().optional().catch(undefined),
  // Reserved key `use-list-shell-state.ts` stores row selection under — it
  // must be declared here or TanStack Router's `validateSearch` strips it
  // from the URL on every navigation. No bulk actions on this page.
  selected: z.string().optional().catch(undefined),
});

interface HomeworkSearchFilters {
  class_id?: string | undefined;
  section_id?: string | undefined;
  subject_id?: string | undefined;
  status?: string | undefined;
}

function toHomeworkFilters(filters: HomeworkSearchFilters): HomeworkListFilters {
  return {
    ...(filters.class_id !== undefined ? { class_id: filters.class_id } : {}),
    ...(filters.section_id !== undefined ? { section_id: filters.section_id } : {}),
    ...(filters.subject_id !== undefined ? { subject_id: filters.subject_id } : {}),
    ...(filters.status !== undefined ? { status: filters.status as HomeworkAssignmentStatus } : {}),
  };
}

export const Route = createFileRoute('/_staff/academics/homework/')({
  validateSearch: homeworkSearchSchema,
  loaderDeps: ({ search }) => ({
    classId: search.class_id,
    sectionId: search.section_id,
    subjectId: search.subject_id,
    status: search.status,
  }),
  loader: ({ context: { queryClient }, deps }) =>
    Promise.all([
      queryClient
        .ensureQueryData(
          homeworkListQueryOptions(
            toHomeworkFilters({
              class_id: deps.classId,
              section_id: deps.sectionId,
              subject_id: deps.subjectId,
              status: deps.status,
            }),
          ),
        )
        .catch(swallowUnlessOffline),
      loadRouteNamespaces('homework'),
    ]),
  pendingComponent: HomeworkListPending,
  component: HomeworkListPage,
});

function HomeworkListPage() {
  const { t } = useTranslation('homework');
  const regionConfig = useTenantRegionConfig();
  const [state, actions] = useListShellState({ limit: 10 });
  const filters = state.filters as HomeworkSearchFilters;

  const canAssign = useHasPermission(Permission.HOMEWORK_ASSIGN);
  const canImport = useHasPermission(Permission.HOMEWORK_IMPORT);

  const homeworkQuery = useHomeworkList(toHomeworkFilters(filters));
  const classesQuery = useClasses();
  const sectionsQuery = useClassSections(filters.class_id);
  const subjectsQuery = useSubjects({ limit: 100 });

  const classById = new Map((classesQuery.data?.data ?? []).map((klass) => [klass.id, klass]));
  const subjectById = new Map(
    (subjectsQuery.data?.data ?? []).map((subject) => [subject.id, subject]),
  );

  function handleFilterChange(patch: Record<string, string | null>) {
    const next = { ...patch };
    if ('class_id' in next) next.section_id = null;
    actions.setFilters(next);
  }

  const filterFields: FilterFieldDescriptor[] = [
    {
      kind: 'select',
      key: 'class_id',
      label: t('list.classLabel'),
      allLabel: t('list.allClasses'),
      options: (classesQuery.data?.data ?? []).map((klass) => ({
        value: klass.id,
        label: klass.name,
      })),
    },
    {
      kind: 'select',
      key: 'section_id',
      label: t('list.sectionLabel'),
      allLabel: t('list.allSections'),
      options: (sectionsQuery.data ?? []).map((section) => ({
        value: section.id,
        label: section.section_name,
      })),
    },
    {
      kind: 'select',
      key: 'subject_id',
      label: t('list.subjectLabel'),
      allLabel: t('list.allSubjects'),
      options: (subjectsQuery.data?.data ?? []).map((subject) => ({
        value: subject.id,
        label: subject.name_en,
      })),
    },
    {
      kind: 'select',
      key: 'status',
      label: t('list.statusLabel'),
      allLabel: t('list.allStatuses'),
      options: Object.values(HomeworkAssignmentStatus).map((status) => ({
        value: status,
        label: t(`form.status.${status}`),
      })),
    },
  ];

  const rows = homeworkQuery.data ?? [];
  const page = state.page;
  const limit = state.limit;
  // ponytail: client-side paging over GET /homework's unpaginated array;
  // move to server paging if a tenant's homework count makes the payload
  // heavy.
  const pageRows = rows.slice((page - 1) * limit, page * limit);

  const columns: DataTableColumn<Homework>[] = [
    {
      id: 'title',
      header: t('list.columnTitle'),
      accessorFn: (row) => (
        <Link
          to="/academics/homework/$homeworkId"
          params={{ homeworkId: row.id }}
          className="font-medium text-primary underline"
        >
          {row.title}
        </Link>
      ),
      card: 'title',
    },
    {
      id: 'subject',
      header: t('list.columnSubject'),
      accessorFn: (row) => subjectById.get(row.subject_id)?.name_en ?? '—',
    },
    {
      id: 'class',
      header: t('list.columnClass'),
      accessorFn: (row) => classById.get(row.class_id)?.name ?? '—',
    },
    {
      id: 'gradingMode',
      header: t('list.columnGradingMode'),
      accessorFn: (row) => t(`form.gradingMode.${row.grading_mode}`),
    },
    {
      id: 'created',
      header: t('list.columnCreated'),
      accessorFn: (row) => formatDate(parseServerDate(row.created_at), regionConfig),
    },
  ];

  return (
    <ListShell
      title={t('list.title')}
      primaryAction={
        canImport || canAssign ? (
          <div className="flex items-center gap-2">
            {canImport && (
              <Button asChild variant="outline">
                <Link to="/academics/homework/import">{t('list.importHomework')}</Link>
              </Button>
            )}
            {canAssign && (
              <Button asChild>
                <Link to="/academics/homework/new">{t('list.assignHomework')}</Link>
              </Button>
            )}
          </div>
        ) : undefined
      }
      filters={{ fields: filterFields, values: state.filters, onChange: handleFilterChange }}
      tableId="homework-list"
      caption={t('list.caption')}
      columns={columns}
      data={pageRows}
      getRowId={(row) => row.id}
      sorting={state.sorting}
      onSortingChange={actions.setSorting}
      page={page}
      pageSize={limit}
      totalCount={rows.length}
      onPageChange={actions.setPage}
      onPageSizeChange={actions.setLimit}
      pageSizeLabel={t('pagination.rowsPerPage', { ns: 'common' })}
      loading={homeworkQuery.isLoading}
      isFetching={homeworkQuery.isFetching}
      {...(homeworkQuery.isError ? { error: t('list.errorMessage') } : {})}
      emptyMessage={t('list.emptyMessage')}
      announceResults={(count, total) =>
        t('list.announceResults', { visible: count, total, count: total })
      }
    />
  );
}

function HomeworkListPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="list" label={t('routePending.label', { ns: 'nav' })} />;
}
