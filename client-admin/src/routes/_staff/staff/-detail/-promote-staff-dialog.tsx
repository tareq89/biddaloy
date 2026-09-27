/**
 * [23.9] Promote a staff member to a new designation, effective a given
 * date — `POST /staff-hr-records/:userId/promote` ([23.2] D7's atomic
 * close-then-insert). Cloned from `-promote-teacher-dialog.tsx`'s
 * form-in-dialog shape (same folder), but this dialog *changes* an
 * existing person's designation rather than creating a brand-new
 * profile, so there's no member picker — the user is already fixed by
 * the tab it's opened from.
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
  Textarea,
} from '@biddaloy/ui/components';
import { useDesignations, usePromoteStaff } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

export interface PromoteStaffDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
}

function toLocalDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function PromoteStaffDialog({ open, onOpenChange, userId }: PromoteStaffDialogProps) {
  const { t } = useTranslation('staff');
  const regionConfig = useRegionConfig();
  const designationsQuery = useDesignations();
  const promoteStaff = usePromoteStaff(userId);

  const [designationId, setDesignationId] = React.useState('');
  const [effectiveDate, setEffectiveDate] = React.useState<Date | undefined>(undefined);
  const [notes, setNotes] = React.useState('');
  const [validationError, setValidationError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setDesignationId('');
    setEffectiveDate(undefined);
    setNotes('');
    setValidationError(null);
    promoteStaff.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only on open/close transitions
  }, [open]);

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (designationId === '') {
      setValidationError(t('hrRecord.promote.errorDesignationRequired'));
      return;
    }
    if (effectiveDate === undefined) {
      setValidationError(t('hrRecord.promote.errorEffectiveDateRequired'));
      return;
    }
    setValidationError(null);
    const trimmedNotes = notes.trim();
    promoteStaff.mutate(
      {
        designation_id: designationId,
        effective_date: toLocalDateString(effectiveDate),
        ...(trimmedNotes !== '' ? { notes: trimmedNotes } : {}),
      },
      { onSuccess: () => onOpenChange(false) },
    );
  }

  const conflict =
    promoteStaff.isError &&
    promoteStaff.error instanceof ApiError &&
    promoteStaff.error.statusCode === 409;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{t('hrRecord.promote.title')}</DialogTitle>
            <DialogDescription>{t('hrRecord.promote.description')}</DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">{t('hrRecord.promote.designationLabel')}</span>
            <Select value={designationId} onValueChange={setDesignationId}>
              <SelectTrigger aria-label={t('hrRecord.promote.designationLabel')}>
                <SelectValue placeholder={t('hrRecord.promote.designationPlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                {(designationsQuery.data ?? []).map((designation) => (
                  <SelectItem key={designation.id} value={designation.id}>
                    {designation.title_en}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">{t('hrRecord.promote.effectiveDateLabel')}</span>
            <DatePicker
              aria-label={t('hrRecord.promote.effectiveDateLabel')}
              config={regionConfig}
              value={effectiveDate}
              onValueChange={setEffectiveDate}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="promote-staff-notes" className="text-sm font-medium">
              {t('hrRecord.promote.notesLabel')}
            </label>
            <Textarea
              id="promote-staff-notes"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </div>

          {validationError && (
            <p role="alert" className="text-sm text-destructive">
              {validationError}
            </p>
          )}
          {promoteStaff.isError && (
            <p role="alert" className="text-sm text-destructive">
              {conflict ? t('hrRecord.promote.errorConflict') : t('hrRecord.promote.errorMessage')}
            </p>
          )}

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {t('actions.cancel', { ns: 'common' })}
              </Button>
            </DialogClose>
            <Button type="submit" loading={promoteStaff.isPending}>
              {promoteStaff.isPending ? t('hrRecord.promote.saving') : t('hrRecord.promote.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
