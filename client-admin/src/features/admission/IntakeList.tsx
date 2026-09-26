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
  type DataTableColumn,
} from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';
import { ListShell, useListShellState } from '@biddaloy/ui/shells';
import { Link } from '@tanstack/react-router';
import * as React from 'react';

import {
  useClassSectionOptions,
  useCreateIntake,
  useIntakes,
  type AdmissionIntake,
} from './hooks/useIntakes';
import {
  EMPTY_INTAKE_FORM,
  IntakeForm,
  isIntakeFormValid,
  toIntakeInput,
  type IntakeFormValue,
} from './IntakeForm';

export function IntakeList() {
  const { t } = useTranslation('admission-staff-intakes');
  const [state, actions] = useListShellState({ limit: 25 });
  const intakesQuery = useIntakes();
  const { options: sectionOptions } = useClassSectionOptions();

  const [createOpen, setCreateOpen] = React.useState(false);
  const [form, setForm] = React.useState<IntakeFormValue>(EMPTY_INTAKE_FORM);
  const createIntake = useCreateIntake();

  function sectionLabel(intake: AdmissionIntake): string {
    const option = sectionOptions.find((candidate) => candidate.id === intake.class_section_id);
    return option ? `${option.className} · ${option.sectionName}` : intake.class_section_id;
  }

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

  const columns: DataTableColumn<AdmissionIntake>[] = [
    {
      id: 'title',
      header: t('list.columnTitle'),
      accessorFn: (row) => (
        <Link
          to="/admissions/intakes/$intakeId"
          params={{ intakeId: row.id }}
          className="font-medium text-primary underline"
        >
          {row.title}
        </Link>
      ),
    },
    {
      id: 'classSection',
      header: t('list.columnClassSection'),
      accessorFn: (row) => sectionLabel(row),
    },
    {
      id: 'seatCount',
      header: t('list.columnSeatCount'),
      accessorFn: (row) => row.seat_count,
      align: 'end',
    },
    {
      id: 'openDate',
      header: t('list.columnOpenDate'),
      accessorFn: (row) => row.open_date,
    },
    {
      id: 'closeDate',
      header: t('list.columnCloseDate'),
      accessorFn: (row) => row.close_date,
    },
    {
      id: 'status',
      header: t('list.columnStatus'),
      accessorFn: (row) => (
        <span
          className={
            row.status === 'OPEN'
              ? 'inline-flex items-center rounded-full bg-status-paid-bg px-2 py-0.5 text-xs font-medium text-status-paid-fg'
              : 'inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground'
          }
        >
          {row.status === 'OPEN' ? t('list.statusOpen') : t('list.statusClosed')}
        </span>
      ),
    },
  ];

  return (
    <>
      <ListShell
        title={t('list.title')}
        primaryAction={
          <Button type="button" onClick={() => setCreateOpen(true)}>
            {t('list.addIntake')}
          </Button>
        }
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
        emptyMessage={t('list.emptyMessage')}
      />

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
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
