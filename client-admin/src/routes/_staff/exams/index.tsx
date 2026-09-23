/**
 * Exams list — [19.6.1]. Same list-shell shape as `classes/index.tsx`:
 * a filter bar (academic year), a create dialog, an edit dialog, each
 * row's name linking into the exam's detail page.
 */
import { Permission } from '@biddaloy/shared';
import {
  Button,
  RoutePending,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@biddaloy/ui/components';
import {
  examsQueryOptions,
  useAcademicYears,
  useExams,
  useHasPermission,
} from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { ListShell, useListShellState } from '@biddaloy/ui/shells';
import { createFileRoute, Link } from '@tanstack/react-router';
import * as React from 'react';

import { loadRouteNamespaces, swallowUnlessOffline } from '../../../route-loaders';

import { ExamFormDialog } from './-exam-form-dialog';

export const Route = createFileRoute('/_staff/exams/')({
  loader: ({ context: { queryClient } }) =>
    Promise.all([
      queryClient.ensureQueryData(examsQueryOptions({})).catch(swallowUnlessOffline),
      loadRouteNamespaces('exams', 'common'),
    ]),
  pendingComponent: ExamsListPending,
  component: ExamsListPage,
});

/** Same "Select rejects an empty string" sentinel `classes/index.tsx` uses
 * for its academic-year filter — a real academic year id is a UUID, so no
 * collision risk with a plain sentinel here. */
const ALL_VALUE = '__all__';

function ExamsListPage() {
  const { t } = useTranslation('exams');
  const [state, actions] = useListShellState({ limit: 10 });
  const canManage = useHasPermission(Permission.EXAM_MANAGE);
  const academicYearsQuery = useAcademicYears();

  const academicYearId = state.filters.academic_year_id;

  const filters = {
    ...(academicYearId && academicYearId !== ALL_VALUE ? { academic_year_id: academicYearId } : {}),
    page: state.page,
    limit: state.limit,
  };
  const examsQuery = useExams(filters);

  const [createOpen, setCreateOpen] = React.useState(false);

  return (
    <>
      <ListShell
        title={t('list.title')}
        primaryAction={
          canManage && (
            <Button type="button" onClick={() => setCreateOpen(true)}>
              {t('list.addExam')}
            </Button>
          )
        }
        filterBar={
          <Select
            value={academicYearId ?? ALL_VALUE}
            onValueChange={(value) =>
              actions.setFilters({ ...state.filters, academic_year_id: value })
            }
          >
            <SelectTrigger aria-label={t('list.academicYearLabel')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_VALUE}>{t('list.allAcademicYears')}</SelectItem>
              {academicYearsQuery.data?.data.map((year) => (
                <SelectItem key={year.id} value={year.id}>
                  {year.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
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
                className="font-medium text-primary underline"
              >
                {row.name}
              </Link>
            ),
          },
          {
            id: 'kind',
            header: t('list.columnKind'),
            accessorFn: (row) => t(`kind.${row.kind}`),
          },
          {
            id: 'status',
            header: t('list.columnStatus'),
            accessorFn: (row) => t(`status.${row.status}`),
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
        pageSizeLabel={t('pagination.rowsPerPage', { ns: 'common' })}
        loading={examsQuery.isLoading}
        isFetching={examsQuery.isFetching}
        {...(examsQuery.isError ? { error: t('list.errorMessage') } : {})}
        emptyMessage={t('list.emptyMessage')}
        announceResults={(count, total) =>
          t('list.announceResults', { visible: count, total, count: total })
        }
      />

      {canManage && (
        <ExamFormDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          mode="create"
          {...(academicYearId && academicYearId !== ALL_VALUE
            ? { defaultAcademicYearId: academicYearId }
            : {})}
          onSaved={() => setCreateOpen(false)}
        />
      )}
    </>
  );
}

function ExamsListPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="list" label={t('routePending.label', { ns: 'nav' })} />;
}
