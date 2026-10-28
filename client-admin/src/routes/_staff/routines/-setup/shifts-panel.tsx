/**
 * [21.7.1] "Shifts" panel — name + day start/end, a small tenant-scoped
 * list (a school has a handful of shifts, so the table is unpaginated).
 * Deleting a shift still referenced by period slots is refused by the
 * server's 409 (`ShiftsService.remove`); [31.4] that is translated
 * (`inUseError`), never shown verbatim. Choosing which shift's periods to
 * edit lives in `PeriodSlotsPanel`'s own Select, not here.
 */
import { ApiError } from '@biddaloy/ui/api';
import {
  Button,
  Card,
  ConfirmDialog,
  DataTable,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  HelpHint,
  Label,
  TimeInput,
  toast,
  type DataTableColumn,
} from '@biddaloy/ui/components';
import {
  useCreateShift,
  useDeleteShift,
  useShifts,
  useUpdateShift,
  type Shift,
} from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatTime, parseValidationFieldErrors } from '@biddaloy/ui/utils';
import { PlusIcon } from 'lucide-react';
import * as React from 'react';

/** Mirrors `server/src/modules/routines/dto/setup.dto.ts`. */
const SHIFT_NAME_MAX = 100;

function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

export function ShiftsPanel() {
  const { t } = useTranslation('routines');
  const config = useRegionConfig();
  const shiftsQuery = useShifts();
  const createShift = useCreateShift();
  const deleteShift = useDeleteShift();
  const [editing, setEditing] = React.useState<Shift | null>(null);
  const updateShift = useUpdateShift(editing?.id ?? '');

  const [addOpen, setAddOpen] = React.useState(false);
  const [deleting, setDeleting] = React.useState<Shift | null>(null);
  const [name, setName] = React.useState('');
  const [dayStartsAt, setDayStartsAt] = React.useState('08:00');
  const [dayEndsAt, setDayEndsAt] = React.useState('16:00');
  const [saveFailed, setSaveFailed] = React.useState(false);
  const [nameError, setNameError] = React.useState<string | null>(null);
  const [periodsOutside, setPeriodsOutside] = React.useState(false);

  const shifts = shiftsQuery.data?.data ?? [];
  const endBeforeStart = timeToMinutes(dayEndsAt) <= timeToMinutes(dayStartsAt);

  function openEdit(shift: Shift) {
    setEditing(shift);
    setName(shift.name);
    setDayStartsAt(shift.day_starts_at.slice(0, 5));
    setDayEndsAt(shift.day_ends_at.slice(0, 5));
    setAddOpen(true);
  }

  function closeAdd() {
    setAddOpen(false);
    setEditing(null);
    setName('');
    setDayStartsAt('08:00');
    setDayEndsAt('16:00');
    setSaveFailed(false);
    setPeriodsOutside(false);
    setNameError(null);
  }

  function handleAdd(event: React.FormEvent) {
    event.preventDefault();
    if (endBeforeStart) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setNameError(t('shiftsPanel.nameRequired'));
      return;
    }
    if (trimmed.length > SHIFT_NAME_MAX) {
      setNameError(t('shiftsPanel.nameTooLong', { max: SHIFT_NAME_MAX }));
      return;
    }
    setNameError(null);
    setSaveFailed(false);
    setPeriodsOutside(false);
    const handlers = {
      onSuccess: closeAdd,
      onError: (error: unknown) => {
        // A 400 that names `name`: our own sentence under the field, never the server's text.
        if (
          error instanceof ApiError &&
          error.statusCode === 400 &&
          'name' in parseValidationFieldErrors(error.messages, ['name'])
        ) {
          setNameError(t('shiftsPanel.nameInvalid'));
        } else if (
          error instanceof ApiError &&
          error.statusCode === 409 &&
          error.details?.['code'] === 'SHIFT_PERIODS_OUTSIDE_WINDOW'
        ) {
          setPeriodsOutside(true);
        } else {
          setSaveFailed(true);
        }
      },
    };
    if (editing) {
      updateShift.mutate(
        { name: trimmed, day_starts_at: dayStartsAt, day_ends_at: dayEndsAt },
        handlers,
      );
    } else {
      createShift.mutate(
        {
          name: trimmed,
          day_starts_at: dayStartsAt,
          day_ends_at: dayEndsAt,
          sequence: shifts.length,
        },
        handlers,
      );
    }
  }

  function handleDelete() {
    if (!deleting) return;
    deleteShift.mutate(deleting.id, {
      onSuccess: () => setDeleting(null),
      onError: (error) => {
        setDeleting(null);
        toast.error(
          t(
            error instanceof ApiError && error.statusCode === 409
              ? 'shiftsPanel.inUseError'
              : 'shiftsPanel.deleteError',
          ),
        );
      },
    });
  }

  const range = (shift: Shift) =>
    t('shiftsPanel.timeRange', {
      start: formatTime(shift.day_starts_at, config),
      end: formatTime(shift.day_ends_at, config),
    });

  const columns: DataTableColumn<Shift>[] = [
    {
      id: 'name',
      header: t('shiftsPanel.name'),
      card: 'title',
      accessorFn: (shift) => (
        <>
          <span className="font-medium">{shift.name}</span>
          <span className="block text-caption text-text-secondary md:hidden">{range(shift)}</span>
        </>
      ),
    },
    {
      id: 'start',
      header: t('shiftsPanel.dayStartsAt'),
      card: 'hidden',
      accessorFn: (shift) => formatTime(shift.day_starts_at, config),
    },
    {
      id: 'end',
      header: t('shiftsPanel.dayEndsAt'),
      card: 'hidden',
      accessorFn: (shift) => formatTime(shift.day_ends_at, config),
    },
  ];

  return (
    <Card padded={false} className="overflow-hidden">
      <section aria-label={t('shiftsPanel.legend')}>
        <div className="flex flex-col gap-3 p-4 md:flex-row md:items-start md:justify-between md:p-5">
          <div>
            <h2 className="text-h2">{t('shiftsPanel.legend')}</h2>
            <p className="mt-1 text-text-secondary">{t('shiftsPanel.subtitle')}</p>
          </div>
          <Button type="button" variant="outline" onClick={() => setAddOpen(true)}>
            <PlusIcon aria-hidden="true" />
            {t('shiftsPanel.addAction')}
          </Button>
        </div>

        <DataTable
          tableId="routine-shifts"
          caption={t('shiftsPanel.caption')}
          columns={columns}
          data={shifts}
          getRowId={(shift) => shift.id}
          sorting={null}
          onSortingChange={() => {}}
          paginated={false}
          totalCount={shifts.length}
          loading={shiftsQuery.isPending}
          rowActions={(shift) => [
            { intent: 'edit', label: t('edit.action'), onClick: () => openEdit(shift) },
            { intent: 'delete', label: t('delete.action'), onClick: () => setDeleting(shift) },
          ]}
        />
      </section>

      <Dialog open={addOpen} onOpenChange={(open) => (open ? setAddOpen(true) : closeAdd())}>
        <DialogContent size="sm">
          <form className="flex flex-col gap-4" onSubmit={handleAdd}>
            <DialogHeader>
              <DialogTitle>
                {t(editing ? 'shiftsPanel.editTitle' : 'shiftsPanel.dialogTitle')}
              </DialogTitle>
              <DialogDescription>{t('shiftsPanel.subtitle')}</DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-1">
                <Label htmlFor="shift-name">{t('shiftsPanel.name')}</Label>
                <HelpHint helpId="academics.routineSetup.field.shiftName" />
              </div>
              <Input
                id="shift-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                aria-invalid={nameError !== null}
                aria-describedby={nameError ? 'shift-name-error' : undefined}
              />
              {nameError && (
                <p id="shift-name-error" role="alert" className="text-caption text-destructive">
                  {nameError}
                </p>
              )}
            </div>
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-1">
                <Label htmlFor="shift-day-starts-at">{t('shiftsPanel.dayStartsAt')}</Label>
                <HelpHint helpId="academics.routineSetup.field.shiftStart" />
              </div>
              <TimeInput
                id="shift-day-starts-at"
                aria-label={t('shiftsPanel.dayStartsAt')}
                value={dayStartsAt}
                onValueChange={setDayStartsAt}
                stepMinutes={15}
              />
            </div>
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-1">
                <Label htmlFor="shift-day-ends-at">{t('shiftsPanel.dayEndsAt')}</Label>
                <HelpHint helpId="academics.routineSetup.field.shiftEnd" />
              </div>
              <TimeInput
                id="shift-day-ends-at"
                aria-label={t('shiftsPanel.dayEndsAt')}
                value={dayEndsAt}
                onValueChange={setDayEndsAt}
                stepMinutes={15}
              />
              {endBeforeStart && (
                <p role="alert" className="text-caption text-destructive">
                  {t('shiftsPanel.endBeforeStart')}
                </p>
              )}
            </div>
            {(saveFailed || periodsOutside) && (
              <p role="alert" className="text-caption text-destructive">
                {t(periodsOutside ? 'shiftsPanel.periodsOutsideError' : 'shiftsPanel.saveError')}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={closeAdd}>
                {t('shiftsPanel.cancel')}
              </Button>
              <Button
                type="submit"
                disabled={endBeforeStart}
                loading={createShift.isPending || updateShift.isPending}
              >
                {t(editing ? 'shiftsPanel.editConfirm' : 'shiftsPanel.dialogConfirm')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        tone="danger"
        title={t('shiftsPanel.deleteTitle', { name: deleting?.name ?? '' })}
        description={t('shiftsPanel.deleteDescription')}
        confirmLabel={t('shiftsPanel.deleteConfirm')}
        cancelLabel={t('shiftsPanel.cancel')}
        busy={deleteShift.isPending}
        onConfirm={handleDelete}
      />
    </Card>
  );
}
