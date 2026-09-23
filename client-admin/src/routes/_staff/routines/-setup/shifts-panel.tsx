/**
 * [21.7.1] "Shifts" panel — name + day start/end, a small tenant-scoped
 * list (not the paginated `DataTable`/`ListShell` machinery — a school
 * has a handful of shifts, not thousands, so a plain table is the lazy
 * and correct fit here). Deleting a shift still referenced by period
 * slots surfaces the server's 409 refusal (`ShiftsService.remove`) and
 * its slot count verbatim via `MutationErrorMessage`.
 */
import { Button, Input, Label } from '@biddaloy/ui/components';
import { useCreateShift, useDeleteShift, useShifts, type Shift } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

import { MutationErrorMessage } from '../../../../components/MutationErrorMessage';

export interface ShiftsPanelProps {
  selectedShiftId: string | undefined;
  onSelectShift: (shiftId: string) => void;
}

export function ShiftsPanel({ selectedShiftId, onSelectShift }: ShiftsPanelProps) {
  const { t } = useTranslation('routines');
  const shiftsQuery = useShifts();
  const createShift = useCreateShift();
  const deleteShift = useDeleteShift();

  const [name, setName] = React.useState('');
  const [dayStartsAt, setDayStartsAt] = React.useState('08:00');
  const [dayEndsAt, setDayEndsAt] = React.useState('16:00');

  const shifts = shiftsQuery.data?.data ?? [];

  function handleAdd(event: React.FormEvent) {
    event.preventDefault();
    createShift.mutate(
      { name, day_starts_at: dayStartsAt, day_ends_at: dayEndsAt, sequence: shifts.length },
      { onSuccess: () => setName('') },
    );
  }

  function handleDelete(shift: Shift) {
    deleteShift.mutate(shift.id);
  }

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-base font-medium">{t('shiftsPanel.legend')}</h2>

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-muted-foreground">
            <th className="py-1.5 font-normal">{t('shiftsPanel.name')}</th>
            <th className="py-1.5 font-normal">{t('shiftsPanel.dayStartsAt')}</th>
            <th className="py-1.5 font-normal">{t('shiftsPanel.dayEndsAt')}</th>
            <th className="py-1.5" />
          </tr>
        </thead>
        <tbody>
          {shifts.map((shift) => (
            <tr key={shift.id} className="border-b">
              <td className="py-1.5">
                <button
                  type="button"
                  className={shift.id === selectedShiftId ? 'font-medium underline' : 'text-left'}
                  onClick={() => onSelectShift(shift.id)}
                >
                  {shift.name}
                </button>
              </td>
              <td className="py-1.5">{shift.day_starts_at}</td>
              <td className="py-1.5">{shift.day_ends_at}</td>
              <td className="py-1.5 text-right">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => handleDelete(shift)}
                >
                  {t('delete.action')}
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <form className="flex flex-wrap items-end gap-3" onSubmit={handleAdd}>
        <div className="flex flex-col gap-1">
          <Label htmlFor="shift-name">{t('shiftsPanel.name')}</Label>
          <Input
            id="shift-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="shift-day-starts-at">{t('shiftsPanel.dayStartsAt')}</Label>
          <Input
            id="shift-day-starts-at"
            type="time"
            value={dayStartsAt}
            onChange={(event) => setDayStartsAt(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="shift-day-ends-at">{t('shiftsPanel.dayEndsAt')}</Label>
          <Input
            id="shift-day-ends-at"
            type="time"
            value={dayEndsAt}
            onChange={(event) => setDayEndsAt(event.target.value)}
          />
        </div>
        <Button type="submit" loading={createShift.isPending}>
          {t('shiftsPanel.addAction')}
        </Button>
      </form>
      {createShift.isError && <MutationErrorMessage error={createShift.error} />}
      {deleteShift.isError && <MutationErrorMessage error={deleteShift.error} />}
    </section>
  );
}
