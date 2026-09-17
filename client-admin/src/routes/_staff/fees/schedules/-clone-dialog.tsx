/**
 * [16.7.5] "Clone for next year" — copies a schedule's fees/audience/
 * rule into a new schedule under a different academic year, per issue
 * #679's row action. Small Tier B dialog, same shape as
 * `-schedule-form-dialog.tsx` but with only the two fields cloning
 * actually needs (target year, optional rename).
 */
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
} from '@biddaloy/ui/components';
import {
  useAcademicYears,
  useCloneRecurringSchedule,
  type RecurringSchedule,
} from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

export interface CloneScheduleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  schedule: RecurringSchedule;
  onCloned: () => void;
}

export function CloneScheduleDialog({
  open,
  onOpenChange,
  schedule,
  onCloned,
}: CloneScheduleDialogProps) {
  const { t } = useTranslation('fees');
  const yearsQuery = useAcademicYears();
  const cloneSchedule = useCloneRecurringSchedule();

  const [academicYearId, setAcademicYearId] = React.useState('');
  const [name, setName] = React.useState(schedule.name);

  React.useEffect(() => {
    if (!open) return;
    cloneSchedule.reset();
    setAcademicYearId('');
    setName(schedule.name);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only on open/close transitions
  }, [open]);

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (academicYearId === '') return;
    const trimmedName = name.trim();
    cloneSchedule.mutate(
      {
        id: schedule.id,
        academic_year_id: academicYearId,
        ...(trimmedName ? { name: trimmedName } : {}),
      },
      { onSuccess: onCloned },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{t('schedules.cloneDialog.title')}</DialogTitle>
            <DialogDescription>{t('schedules.cloneDialog.description')}</DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="clone-schedule-year" className="text-sm font-medium">
              {t('schedules.cloneDialog.academicYearLabel')}
            </label>
            <Select value={academicYearId} onValueChange={setAcademicYearId}>
              <SelectTrigger
                id="clone-schedule-year"
                aria-label={t('schedules.cloneDialog.academicYearLabel')}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(yearsQuery.data?.data ?? [])
                  .filter((year) => year.id !== schedule.academic_year_id)
                  .map((year) => (
                    <SelectItem key={year.id} value={year.id}>
                      {year.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="clone-schedule-name" className="text-sm font-medium">
              {t('schedules.cloneDialog.nameLabel')}
            </label>
            <Input
              id="clone-schedule-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>

          {cloneSchedule.isError && (
            <p role="alert" className="text-sm text-destructive">
              {t('schedules.cloneDialog.errorMessage')}
            </p>
          )}

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {t('schedules.form.cancel')}
              </Button>
            </DialogClose>
            <Button
              type="submit"
              disabled={academicYearId === ''}
              loading={cloneSchedule.isPending}
            >
              {cloneSchedule.isPending
                ? t('schedules.cloneDialog.cloning')
                : t('schedules.cloneDialog.confirm')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
