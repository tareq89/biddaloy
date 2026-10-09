/**
 * [27.9] Admission intakes list — table→card responsive via `ListShell`,
 * cloned from the grading-scales list shell
 * (`client-admin/src/routes/_staff/grading-scales/index.tsx`). The whole
 * screen is already gated behind `ADMISSION_REVIEW` at the route level
 * (`_staff.tsx` + `route-permissions.ts`), so every action here is shown
 * unconditionally — there's no separate "read only" role for this screen.
 */
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  StatusBadge,
  type DataTableColumn,
} from '@biddaloy/ui/components';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { ListShell, useListShellState } from '@biddaloy/ui/shells';
import { formatDateRange, formatNumber } from '@biddaloy/ui/utils';
import { DoorOpenIcon, PlusIcon } from 'lucide-react';
import * as React from 'react';

import { useCreateIntake, useIntakes, type IntakeListRow } from './hooks/useIntakes';
import {
  EMPTY_INTAKE_FORM,
  IntakeForm,
  isIntakeFormValid,
  toIntakeInput,
  type IntakeFormValue,
} from './IntakeForm';

export function IntakeList() {
  const { t } = useTranslation('admission-staff-intakes');
  const [state, actions] = useListShellState();
  const intakesQuery = useIntakes();
  const regionConfig = useRegionConfig();

  const [createOpen, setCreateOpen] = React.useState(false);
  const [form, setForm] = React.useState<IntakeFormValue>(EMPTY_INTAKE_FORM);
  const createIntake = useCreateIntake();

  function handleCreateSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!isIntakeFormValid(form)) return;
    createIntake.mutate(toIntakeInput(form), {
      onSuccess: () => {
        setCreateOpen(false);
        setForm(EMPTY_INTAKE_FORM);
      },
    });
  }

  const columns: DataTableColumn<IntakeListRow>[] = [
    {
      id: 'title',
      header: t('list.columnTitle'),
      accessorFn: (row) => <span className="font-medium">{row.title}</span>,
      card: 'title',
    },
    {
      id: 'classSection',
      header: t('list.columnClassSection'),
      accessorFn: (row) =>
        row.class_name && row.section_name ? `${row.class_name} · ${row.section_name}` : '—',
      card: 'subtitle',
    },
    {
      id: 'seatCount',
      header: t('list.columnSeatCount'),
      accessorFn: (row) => formatNumber(row.seat_count, regionConfig),
      align: 'end',
    },
    {
      id: 'window',
      header: t('list.columnWindow'),
      accessorFn: (row) => formatDateRange(row.open_date, row.close_date, regionConfig),
    },
    {
      id: 'status',
      header: t('list.columnStatus'),
      accessorFn: (row) => (
        <StatusBadge
          tone={row.status === 'OPEN' ? 'success' : 'neutral'}
          label={row.status === 'OPEN' ? t('list.statusOpen') : t('list.statusClosed')}
        />
      ),
      card: 'badge',
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
            label: t('list.addIntake'),
            icon: <PlusIcon aria-hidden />,
            priority: 'primary',
            onClick: () => setCreateOpen(true),
          },
        ]}
        tableId="admission-intakes-list"
        caption={t('list.caption')}
        columns={columns}
        data={intakesQuery.data ?? []}
        getRowId={(row) => row.id}
        sorting={state.sorting}
        onSortingChange={actions.setSorting}
        page={state.page}
        pageSize={state.limit}
        totalCount={intakesQuery.data?.length ?? 0}
        onPageChange={actions.setPage}
        onPageSizeChange={actions.setLimit}
        pageSizeLabel={t('pagination.rowsPerPage', { ns: 'common' })}
        loading={intakesQuery.isLoading}
        isFetching={intakesQuery.isFetching}
        {...(intakesQuery.isError ? { error: t('list.errorMessage') } : {})}
        rowActions={(row) => [
          {
            intent: 'view',
            label: t('list.viewApplicants'),
            to: `/admissions/applicants?intakeId=${row.id}`,
          },
          {
            intent: 'edit',
            label: t('list.edit'),
            to: `/admissions/intakes/${row.id}`,
            'data-focus-anchor': row.id,
          },
        ]}
        emptyState={{
          icon: <DoorOpenIcon aria-hidden />,
          title: t('list.emptyTitle'),
          explanation: t('list.emptyText'),
          action: { label: t('list.addIntake'), onClick: () => setCreateOpen(true) },
        }}
      />

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent size="md">
          <form onSubmit={handleCreateSubmit} className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>{t('createDialog.title')}</DialogTitle>
            </DialogHeader>

            <IntakeForm value={form} onChange={setForm} />

            {createIntake.isError && (
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
              <Button
                type="submit"
                loading={createIntake.isPending}
                disabled={!isIntakeFormValid(form)}
              >
                {createIntake.isPending ? t('createDialog.saving') : t('createDialog.save')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
