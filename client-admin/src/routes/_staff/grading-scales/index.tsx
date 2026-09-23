/**
 * Grading scales list — [20.3.1]. Filter by academic year, create a new
 * (bandless) scale inline, then open it to edit bands.
 */
import { Permission } from '@biddaloy/shared';
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  type DataTableColumn,
} from '@biddaloy/ui/components';
import {
  gradingScalesQueryOptions,
  useAcademicYears,
  useClasses,
  useCreateGradingScale,
  useGradingScales,
  useHasPermission,
  type GradingScale,
} from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { ListShell, useListShellState } from '@biddaloy/ui/shells';
import { createFileRoute, Link } from '@tanstack/react-router';
import * as React from 'react';

import { loadRouteNamespaces, swallowUnlessOffline } from '../../../route-loaders';

const ALL_VALUE = '__all__';

export const Route = createFileRoute('/_staff/grading-scales/')({
  loader: ({ context: { queryClient } }) =>
    Promise.all([
      queryClient.ensureQueryData(gradingScalesQueryOptions({})).catch(swallowUnlessOffline),
      loadRouteNamespaces('grading', 'common'),
    ]),
  component: GradingScalesListPage,
});

function GradingScalesListPage() {
  const { t } = useTranslation('grading');
  const academicYearsQuery = useAcademicYears();
  const classesQuery = useClasses();
  const [state, actions] = useListShellState({ limit: 25 });
  const canManage = useHasPermission(Permission.GRADING_SCALE_MANAGE);

  const filterYearId = state.filters.academic_year_id;
  const scalesQuery = useGradingScales(
    filterYearId && filterYearId !== ALL_VALUE ? { academic_year_id: filterYearId } : {},
  );

  const [createOpen, setCreateOpen] = React.useState(false);
  const createScale = useCreateGradingScale();
  const [name, setName] = React.useState('');
  const [academicYearId, setAcademicYearId] = React.useState('');
  const [classId, setClassId] = React.useState(ALL_VALUE);

  function classNameFor(scale: GradingScale) {
    if (!scale.class_id) return t('list.yearDefault');
    return (
      classesQuery.data?.data.find((klass) => klass.id === scale.class_id)?.name ?? scale.class_id
    );
  }

  function academicYearNameFor(scale: GradingScale) {
    return (
      academicYearsQuery.data?.data.find((year) => year.id === scale.academic_year_id)?.name ??
      scale.academic_year_id
    );
  }

  function handleCreateSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim() || !academicYearId) return;
    createScale.mutate(
      {
        name: name.trim(),
        academic_year_id: academicYearId,
        class_id: classId === ALL_VALUE ? null : classId,
      },
      {
        onSuccess: () => {
          setCreateOpen(false);
          setName('');
        },
      },
    );
  }

  const columns: DataTableColumn<GradingScale>[] = [
    {
      id: 'name',
      header: t('list.columnName'),
      accessorFn: (row) => (
        <Link
          to="/grading-scales/$scaleId"
          params={{ scaleId: row.id }}
          className="font-medium text-primary underline"
        >
          {row.name}
        </Link>
      ),
    },
    {
      id: 'academicYear',
      header: t('list.columnAcademicYear'),
      accessorFn: (row) => academicYearNameFor(row),
    },
    {
      id: 'class',
      header: t('list.columnClass'),
      accessorFn: (row) => classNameFor(row),
    },
    {
      id: 'bands',
      header: t('list.columnBands'),
      accessorFn: (row) => row.bands.length,
      align: 'end',
    },
    {
      id: 'revision',
      header: t('list.columnRevision'),
      accessorFn: (row) => row.revision,
      align: 'end',
    },
  ];

  return (
    <>
      <ListShell
        title={t('list.title')}
        primaryAction={
          canManage && (
            <Button type="button" onClick={() => setCreateOpen(true)}>
              {t('list.addScale')}
            </Button>
          )
        }
        filterBar={
          <Select
            value={filterYearId ?? ALL_VALUE}
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
        tableId="grading-scales-list"
        caption={t('list.caption')}
        columns={columns}
        data={scalesQuery.data ?? []}
        getRowId={(row) => row.id}
        sorting={state.sorting}
        onSortingChange={actions.setSorting}
        page={state.page}
        pageSize={state.limit}
        totalCount={scalesQuery.data?.length ?? 0}
        onPageChange={actions.setPage}
        onPageSizeChange={actions.setLimit}
        pageSizeLabel={t('pagination.rowsPerPage', { ns: 'common' })}
        loading={scalesQuery.isLoading}
        isFetching={scalesQuery.isFetching}
        {...(scalesQuery.isError ? { error: t('list.errorMessage') } : {})}
        emptyMessage={t('list.emptyMessage')}
      />

      {canManage && (
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogContent>
            <form onSubmit={handleCreateSubmit} className="flex flex-col gap-4">
              <DialogHeader>
                <DialogTitle>{t('createDialog.title')}</DialogTitle>
                <DialogDescription>{t('createDialog.description')}</DialogDescription>
              </DialogHeader>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="scale-name" className="text-sm font-medium">
                  {t('createDialog.nameLabel')}
                </label>
                <Input
                  id="scale-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <span className="text-sm font-medium">{t('createDialog.academicYearLabel')}</span>
                <Select value={academicYearId} onValueChange={setAcademicYearId}>
                  <SelectTrigger aria-label={t('createDialog.academicYearLabel')}>
                    <SelectValue placeholder={t('createDialog.academicYearPlaceholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    {academicYearsQuery.data?.data.map((year) => (
                      <SelectItem key={year.id} value={year.id}>
                        {year.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-col gap-1.5">
                <span className="text-sm font-medium">{t('createDialog.classLabel')}</span>
                <Select value={classId} onValueChange={setClassId}>
                  <SelectTrigger aria-label={t('createDialog.classLabel')}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL_VALUE}>{t('createDialog.yearDefault')}</SelectItem>
                    {classesQuery.data?.data.map((klass) => (
                      <SelectItem key={klass.id} value={klass.id}>
                        {klass.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {createScale.isError && (
                <p role="alert" className="text-sm text-destructive">
                  {t('createDialog.errorMessage')}
                </p>
              )}

              <DialogFooter>
                <DialogClose asChild>
                  <Button type="button" variant="outline">
                    {t('actions.cancel', { ns: 'common' })}
                  </Button>
                </DialogClose>
                <Button type="submit" loading={createScale.isPending}>
                  {createScale.isPending ? t('createDialog.saving') : t('createDialog.save')}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
