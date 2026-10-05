/**
 * Exams list — [19.6.1], redesigned in [31.4.exams-1]: year + class filters,
 * class / year / status columns, view + edit row actions, create + edit dialogs.
 */
import { Permission } from '@biddaloy/shared';
import { RoutePending, Skeleton, type EmptyStateProps } from '@biddaloy/ui/components';
import {
  examsQueryOptions,
  useAcademicYears,
  useClasses,
  useExams,
  useHasPermission,
  type Exam,
} from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { ListShell, useListShellState, type FilterFieldDescriptor } from '@biddaloy/ui/shells';
import { formatNumber } from '@biddaloy/ui/utils';
import { createFileRoute, Link } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import * as React from 'react';
import { z } from 'zod';

import { loadRouteNamespaces, swallowUnlessOffline } from '../../../route-loaders';

import { ExamFormDialog } from './-exam-form-dialog';
import { ExamStatusBadge } from './-exam-status-badge';

// `?create=1` opens the create dialog (palette "Create exam from template",
// same pattern as seat-plans' `?generate=1`); `?template=<id>` pre-selects it.
const examsSearchSchema = z.object({
  // List state; declared so `validateSearch` does not strip it from the URL.
  page: z.number().int().positive().optional().catch(undefined),
  limit: z.number().int().positive().optional().catch(undefined),
  sort: z.string().optional().catch(undefined),
  order: z.enum(['asc', 'desc']).optional().catch(undefined),
  academic_year_id: z.string().optional().catch(undefined),
  class_id: z.string().optional().catch(undefined),
  create: z.coerce.string().optional().catch(undefined),
  template: z.string().optional().catch(undefined),
});

export const Route = createFileRoute('/_staff/exams/')({
  validateSearch: examsSearchSchema,
  loader: ({ context: { queryClient } }) =>
    Promise.all([
      queryClient.ensureQueryData(examsQueryOptions({ page: 1, limit: 25 })).catch(swallowUnlessOffline),
      loadRouteNamespaces('exams', 'common', 'examsTemplateField'),
    ]),
  pendingComponent: ExamsListPending,
  component: ExamsListPage,
});

/** A component, not an `accessorFn` string: table cell values are cached per row,
 * so a name read in `accessorFn` would stay blank if the year list loads later. */
function AcademicYearName({ id }: { id: string }) {
  const query = useAcademicYears({ limit: 100 });
  const name = query.data?.data.find((year) => year.id === id)?.name;
  if (name) return <>{name}</>;
  // Never the id: a skeleton while the year list loads, a dash if still missing.
  return query.isLoading ? <Skeleton className="h-3 w-12" /> : <>—</>;
}

function ExamsListPage() {
  const { t } = useTranslation('exams');
  const config = useRegionConfig();
  const [state, actions] = useListShellState();
  const canManage = useHasPermission(Permission.EXAM_MANAGE);
  const academicYearsQuery = useAcademicYears({ limit: 100 });

  const academicYearId = state.filters.academic_year_id;
  const classId = state.filters.class_id;
  const classesQuery = useClasses(
    { academic_year_id: academicYearId ?? '' },
    { enabled: !!academicYearId },
  );

  const examsQuery = useExams({
    ...(academicYearId ? { academic_year_id: academicYearId } : {}),
    ...(academicYearId && classId ? { class_id: classId } : {}),
    page: state.page,
    limit: state.limit,
  });

  const years = academicYearsQuery.data?.data ?? [];

  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const [createOpen, setCreateOpen] = React.useState(search.create === '1');
  const [editing, setEditing] = React.useState<Exam | null>(null);

  // The page can already be mounted when the palette navigates to `?create=1`,
  // so the flag must open the dialog on every change, not only on first render.
  React.useEffect(() => {
    if (search.create === '1') setCreateOpen(true);
  }, [search.create]);

  // Closing also drops the one-shot params, so a later navigation to the same
  // `?create=1` URL is a real change and re-opens the dialog.
  const handleCreateOpenChange = (open: boolean) => {
    setCreateOpen(open);
    if (!open && (search.create || search.template)) {
      void navigate({
        search: (prev) => ({ ...prev, create: undefined, template: undefined }),
        replace: true,
      });
    }
  };

  // Class names repeat every year, so changing the year drops the class.
  function handleFilterChange(patch: Record<string, string | null>) {
    actions.setFilters('academic_year_id' in patch ? { ...patch, class_id: null } : patch);
  }

  // ponytail: `FilterBar` select fields have no `disabled`; until a year is
  // picked the class select has no options and its "all" row reads as the hint.
  const filterFields: FilterFieldDescriptor[] = [
    {
      kind: 'select',
      key: 'academic_year_id',
      label: t('list.academicYearLabel'),
      allLabel: t('list.allAcademicYears'),
      options: years.map((year) => ({ value: year.id, label: year.name })),
    },
    {
      kind: 'select',
      key: 'class_id',
      label: t('list.classLabel'),
      allLabel: academicYearId ? t('list.allClasses') : t('list.classNeedsYear'),
      options: academicYearId
        ? (classesQuery.data?.data ?? []).map((cls) => ({ value: cls.id, label: cls.name }))
        : [],
    },
  ];

  const hasFilters = !!academicYearId || !!classId;
  const emptyState: EmptyStateProps = hasFilters
    ? {
        title: t('list.noMatchTitle'),
        explanation: t('list.noMatchText'),
        action: {
          label: t('list.clearFilters'),
          onClick: () => actions.setFilters({ academic_year_id: null, class_id: null }),
        },
      }
    : {
        title: t('list.emptyTitle'),
        explanation: t('list.emptyText'),
        // The header already holds the one primary add button; no second one here.
      };

  return (
    <>
      <ListShell
        title={t('list.title')}
        subtitle={t('list.subtitle')}
        actions={[
          {
            id: 'add',
            label: t('list.addExam'),
            icon: <Plus aria-hidden className="size-4" />,
            priority: 'primary',
            allowed: canManage,
            onClick: () => setCreateOpen(true),
          },
        ]}
        filters={{ fields: filterFields, values: state.filters, onChange: handleFilterChange }}
        tableId="exams-list"
        caption={t('list.caption')}
        columns={[
          {
            id: 'name',
            header: t('list.columnName'),
            accessorFn: (row) => (
              <Link
                to="/exams/$examId"
                params={{ examId: row.id }}
                className="font-medium hover:text-primary"
              >
                {row.name}
              </Link>
            ),
            card: 'title',
          },
          {
            id: 'class',
            header: t('list.columnClass'),
            accessorFn: (row) => row.class?.name ?? '—',
            card: 'subtitle',
          },
          {
            id: 'academicYear',
            header: t('list.columnAcademicYear'),
            accessorFn: (row) => <AcademicYearName id={row.academic_year_id} />,
          },
          {
            id: 'kind',
            header: t('list.columnKind'),
            accessorFn: (row) => t(`kind.${row.kind}`),
          },
          {
            id: 'status',
            header: t('list.columnStatus'),
            accessorFn: (row) => <ExamStatusBadge status={row.status} />,
            card: 'badge',
          },
        ]}
        rowActions={(row) => [
          { intent: 'view', label: t('list.view'), to: `/exams/${row.id}` },
          {
            intent: 'edit',
            label: t('list.edit'),
            allowed: canManage,
            onClick: () => setEditing(row),
          },
        ]}
        data={examsQuery.data?.data ?? []}
        getRowId={(row) => row.id}
        sorting={state.sorting}
        onSortingChange={actions.setSorting}
        page={state.page}
        pageSize={state.limit}
        totalCount={examsQuery.data?.total ?? 0}
        onPageChange={actions.setPage}
        onPageSizeChange={actions.setLimit}
        loading={examsQuery.isLoading}
        isFetching={examsQuery.isFetching}
        {...(examsQuery.isError ? { error: t('list.errorMessage') } : {})}
        emptyState={emptyState}
        announceResults={(count, total) =>
          t('list.announceResults', {
            visible: formatNumber(count, config),
            total: formatNumber(total, config),
            count: total,
          })
        }
      />

      {canManage && (
        <ExamFormDialog
          open={createOpen}
          onOpenChange={handleCreateOpenChange}
          mode="create"
          {...(search.template ? { defaultTemplateId: search.template } : {})}
          {...(academicYearId ? { defaultAcademicYearId: academicYearId } : {})}
          onSaved={() => handleCreateOpenChange(false)}
        />
      )}
      {canManage && editing && (
        <ExamFormDialog
          open
          onOpenChange={(open) => !open && setEditing(null)}
          mode="edit"
          examId={editing.id}
          initialValues={{ name: editing.name, kind: editing.kind }}
          onSaved={() => setEditing(null)}
        />
      )}
    </>
  );
}

function ExamsListPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="list" label={t('routePending.label', { ns: 'nav' })} />;
}
