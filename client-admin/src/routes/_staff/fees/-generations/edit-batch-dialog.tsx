/**
 * [16.3.7] "Edit period/due date" dialog opened from `batch-actions.tsx`'s
 * kebab menu.
 *
 * `PATCH /fees/generations/:id` (#651): free while nothing in the batch is
 * collected, `fees.edit_paid` approval once any bill is. A second failure
 * mode is specific to this route: changing the period can collide with an
 * *existing* batch for the same period/class/section, which the server
 * reports as `409` with the conflicting students listed
 * (`PatchFeeGenerationConflict`) — rendered inline rather than as a toast,
 * per the plan's step 4.
 */
import { ApiError } from '@biddaloy/ui/api';
import {
  Button,
  DatePicker,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@biddaloy/ui/components';
import { usePatchFeeGeneration, type PatchFeeGenerationConflict } from '@biddaloy/ui/hooks';
import { useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { parseServerDate } from '@biddaloy/ui/utils';
import * as React from 'react';

export interface EditBatchDialogGeneration {
  id: string;
  period_start: string;
  period_type: 'MONTH' | 'WEEK';
  due_date: string;
}

export interface EditBatchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  generation: EditBatchDialogGeneration;
  /** #651 step 4: only the batches that already have money collected need
   * this called out — every other batch's period/due-date is a free edit. */
  hasCollectedBills: boolean;
  onSaved: () => void;
}

function readConflict(error: unknown): PatchFeeGenerationConflict | null {
  if (!(error instanceof ApiError) || error.statusCode !== 409) return null;
  const students = (error.details as Partial<PatchFeeGenerationConflict> | undefined)?.students;
  return Array.isArray(students) ? { students } : null;
}

export function EditBatchDialog({
  open,
  onOpenChange,
  generation,
  hasCollectedBills,
  onSaved,
}: EditBatchDialogProps) {
  const { t } = useTranslation('fees');
  const regionConfig = useTenantRegionConfig();
  const patchGeneration = usePatchFeeGeneration(generation.id);

  const [periodType, setPeriodType] = React.useState<'MONTH' | 'WEEK'>(generation.period_type);
  const [periodStart, setPeriodStart] = React.useState<Date | undefined>(() =>
    parseServerDate(generation.period_start),
  );
  const [dueDate, setDueDate] = React.useState<Date | undefined>(() =>
    parseServerDate(generation.due_date),
  );

  // Reset only on open/close transitions — same reasoning
  // `-structure-form-dialog.tsx` gives for its own effect: a background
  // refetch of the row this dialog edits must not clobber in-progress
  // typing.
  React.useEffect(() => {
    if (!open) return;
    patchGeneration.reset();
    setPeriodType(generation.period_type);
    setPeriodStart(parseServerDate(generation.period_start));
    setDueDate(parseServerDate(generation.due_date));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only on open/close transitions
  }, [open]);

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!periodStart || !dueDate) return;

    patchGeneration.mutate(
      {
        period_start: periodStart.toISOString(),
        period_type: periodType,
        due_date: dueDate.toISOString(),
      },
      { onSuccess: onSaved },
    );
  }

  const conflict = readConflict(patchGeneration.error);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>{t('generations.editBatchDialog.title')}</DialogTitle>
              <DialogDescription>{t('generations.editBatchDialog.description')}</DialogDescription>
            </DialogHeader>

            {hasCollectedBills && (
              <p className="text-sm text-muted-foreground">
                {t('generations.editBatchDialog.approvalNotice')}
              </p>
            )}

            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">
                {t('generations.editBatchDialog.periodTypeLabel')}
              </span>
              <Select
                value={periodType}
                onValueChange={(value) => setPeriodType(value as 'MONTH' | 'WEEK')}
              >
                <SelectTrigger aria-label={t('generations.editBatchDialog.periodTypeLabel')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="MONTH">
                    {t('generations.editBatchDialog.periodTypeMonth')}
                  </SelectItem>
                  <SelectItem value="WEEK">
                    {t('generations.editBatchDialog.periodTypeWeek')}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">
                {t('generations.editBatchDialog.periodStartLabel')}
              </span>
              <DatePicker
                value={periodStart}
                onValueChange={setPeriodStart}
                config={regionConfig}
                aria-label={t('generations.editBatchDialog.periodStartLabel')}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">
                {t('generations.editBatchDialog.dueDateLabel')}
              </span>
              <DatePicker
                value={dueDate}
                onValueChange={setDueDate}
                config={regionConfig}
                aria-label={t('generations.editBatchDialog.dueDateLabel')}
              />
            </div>

            {conflict && (
              <div role="alert" className="flex flex-col gap-1 text-sm text-destructive">
                <p>{t('generations.editBatchDialog.conflictMessage')}</p>
                <ul className="list-inside list-disc">
                  {conflict.students.map((student: { id: string; full_name: string }) => (
                    <li key={student.id}>{student.full_name}</li>
                  ))}
                </ul>
              </div>
            )}
            {patchGeneration.isError && !conflict && (
              <p role="alert" className="text-sm text-destructive">
                {t('generations.editBatchDialog.errorMessage')}
              </p>
            )}

            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="outline">
                  {t('actions.cancel', { ns: 'common' })}
                </Button>
              </DialogClose>
              <Button type="submit" loading={patchGeneration.isPending}>
                {patchGeneration.isPending
                  ? t('generations.editBatchDialog.saving')
                  : t('actions.save', { ns: 'common' })}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
