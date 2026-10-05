/**
 * Grading scales list — [20.3.1]. Filter by academic year, create a new
 * (bandless) scale inline, then open it to edit bands.
 *
 * [31.4.marks-4a] Names instead of ids (B13), a "no grades yet" badge, a
 * pencil row action, a total, and a create dialog that lands on the editor.
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
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  StatusBadge,
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
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { ListShell, useListShellState } from '@biddaloy/ui/shells';
import { formatNumber } from '@biddaloy/ui/utils';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { CircleAlertIcon, PlusIcon, RulerIcon } from 'lucide-react';
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
  const config = useRegionConfig();
  const navigate = useNavigate();
  // B13: the server caps the page size at 100; a school has a handful of years.
  const academicYearsQuery = useAcademicYears({ limit: 100 });
  const classesQuery = useClasses();
  // The endpoint returns every scale, so the table is unpaginated.
  const [state, actions] = useListShellState();
  const canManage = useHasPermission(Permission.GRADING_SCALE_MANAGE);

  const filterYearId = state.filters.academic_year_id;
  const scalesQuery = useGradingScales(filterYearId ? { academic_year_id: filterYearId } : {});
  const years = academicYearsQuery.data?.data ?? [];

  const [createOpen, setCreateOpen] = React.useState(false);
  const createScale = useCreateGradingScale();
  const [name, setName] = React.useState('');
  const [academicYearId, setAcademicYearId] = React.useState('');
  const [classId, setClassId] = React.useState(ALL_VALUE);

  // A name or a dash, never an id. The table shows its skeleton until both
  // lookups have settled (DataTable caches a cell's value per row, so a cell
  // rendered early would keep its placeholder).
  function classNameFor(scale: GradingScale) {
    if (!scale.class_id) return t('list.yearDefault');
    return classesQuery.data?.data.find((klass) => klass.id === scale.class_id)?.name ?? '—';
  }

  function academicYearNameFor(scale: GradingScale) {
    return years.find((year) => year.id === scale.academic_year_id)?.name ?? '—';
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
        onSuccess: (created) => {
          setCreateOpen(false);
          setName('');
          setAcademicYearId('');
          setClassId(ALL_VALUE);
          // A new scale has no grades; adding them is the only next step.
          void navigate({ to: '/grading-scales/$scaleId', params: { scaleId: created.id } });
        },
      },
    );
  }

  const columns: DataTableColumn<GradingScale>[] = [
    {
      id: 'name',
      header: t('list.columnName'),
      accessorFn: (row) => <span className="font-medium">{row.name}</span>,
      card: 'title',
    },
    {
      id: 'academicYear',
      header: t('list.columnAcademicYear'),
      accessorFn: (row) => academicYearNameFor(row),
      card: 'subtitle',
    },
    {
      id: 'class',
      header: t('list.columnClass'),
      accessorFn: (row) => classNameFor(row),
      card: 'subtitle',
    },
    {
      id: 'bands',
      header: t('list.columnBands'),
      accessorFn: (row) =>
        row.bands.length > 0 ? (
          t('list.bandCount', {
            count: row.bands.length,
            n: formatNumber(row.bands.length, config),
          })
        ) : (
          <StatusBadge tone="warning" label={t('list.noBands')} />
        ),
      align: 'end',
    },
  ];

  return (
    <>
      <ListShell
        title={t('list.title')}
        subtitle={t('list.subtitle')}
        actions={[
          {
            id: 'add',
            label: t('list.addScale'),
            priority: 'primary',
            icon: <PlusIcon />,
            onClick: () => setCreateOpen(true),
            allowed: canManage,
          },
        ]}
        filters={{
          fields: [
            {
              kind: 'select',
              key: 'academic_year_id',
              label: t('list.academicYearLabel'),
              allLabel: t('list.allAcademicYears'),
              options: years.map((y) => ({ value: y.id, label: y.name })),
            },
          ],
          values: state.filters,
          onChange: actions.setFilters,
        }}
        tableId="grading-scales-list"
        caption={t('list.caption')}
        columns={columns}
        data={scalesQuery.data ?? []}
        getRowId={(row) => row.id}
        sorting={null}
        onSortingChange={() => undefined}
        totalCount={scalesQuery.data?.length ?? 0}
        paginated={false}
        rowActions={(row) => [
          { intent: 'edit', label: t('list.edit'), to: `/grading-scales/${row.id}` },
        ]}
        loading={scalesQuery.isLoading || academicYearsQuery.isPending || classesQuery.isPending}
        isFetching={scalesQuery.isFetching}
        {...(scalesQuery.isError ? { error: t('list.errorMessage') } : {})}
        emptyState={{
          icon: <RulerIcon />,
          title: t('list.emptyTitle'),
          explanation: t('list.emptyText'),
        }}
      />

      {canManage && (
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogContent size="sm" closeLabel={t('actions.close', { ns: 'common' })}>
            <form onSubmit={handleCreateSubmit} className="flex flex-col gap-4">
              <DialogHeader>
                <DialogTitle>{t('createDialog.title')}</DialogTitle>
                <DialogDescription>{t('createDialog.description')}</DialogDescription>
              </DialogHeader>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="scale-name">
                  {t('createDialog.nameLabel')}
                  <span aria-hidden="true" className="text-destructive">
                    {' '}
                    *
                  </span>
                </Label>
                <Input
                  id="scale-name"
                  required
                  value={name}
                  placeholder={t('createDialog.namePlaceholder')}
                  onChange={(event) => setName(event.target.value)}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="scale-year">
                  {t('createDialog.academicYearLabel')}
                  <span aria-hidden="true" className="text-destructive">
                    {' '}
                    *
                  </span>
                </Label>
                <Select value={academicYearId} onValueChange={setAcademicYearId}>
                  <SelectTrigger id="scale-year" className="w-full">
                    <SelectValue placeholder={t('createDialog.academicYearPlaceholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    {years.map((year) => (
                      <SelectItem key={year.id} value={year.id}>
                        {year.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="scale-class">{t('createDialog.classLabel')}</Label>
                <Select value={classId} onValueChange={setClassId}>
                  <SelectTrigger id="scale-class" className="w-full">
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
                <p className="text-caption text-text-secondary">{t('createDialog.classHelp')}</p>
              </div>

              {createScale.isError && (
                <p role="alert" className="flex items-center gap-1 text-caption text-destructive">
                  <CircleAlertIcon aria-hidden="true" className="size-3.5" />
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
