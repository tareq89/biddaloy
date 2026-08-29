/**
 * The shared Create/Edit academic year dialog — [8.11.1]. Three fields
 * (name, start date, end date) plus an `is_current` checkbox, local
 * `useState` rather than `FormShell`/react-hook-form: that machinery
 * (autosave, unsaved-changes warning, submit-error focus summary) earns
 * its keep on the Student admission form's field count, not a 3-field
 * modal — same weight class as `transfer-status-dialog.tsx`.
 *
 * Owns only the fields and their client-side validation; the actual
 * mutation (create vs. update) is the caller's — this dialog just calls
 * `onSubmit` with a payload shaped for either.
 */
import {
  Button,
  Checkbox,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DatePicker,
  Input,
} from '@biddaloy/ui/components';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

export interface YearFormPayload {
  name: string;
  start_date: string;
  end_date: string;
  is_current: boolean;
}

export interface YearFormInitialValues {
  name: string;
  startDate: Date;
  endDate: Date;
  isCurrent: boolean;
}

export interface YearFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'create' | 'edit';
  initialValues?: YearFormInitialValues;
  isPending: boolean;
  isError: boolean;
  onSubmit: (payload: YearFormPayload) => void;
}

const EMPTY_VALUES: YearFormInitialValues = {
  name: '',
  startDate: undefined as unknown as Date,
  endDate: undefined as unknown as Date,
  isCurrent: false,
};

/** `date.toISOString().slice(0, 10)` converts to UTC first — `DatePicker`
 * hands back a local-midnight `Date`, so in any timezone ahead of UTC
 * that rolls the date back a day. Reading the local year/month/day
 * components instead serializes the calendar date actually picked — same
 * fix `-student-form-schema.ts`'s `toLocalDateString` documents. */
function toLocalDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function YearFormDialog({
  open,
  onOpenChange,
  mode,
  initialValues,
  isPending,
  isError,
  onSubmit,
}: YearFormDialogProps) {
  const { t } = useTranslation('academicYears');
  const regionConfig = useRegionConfig();

  const [name, setName] = React.useState(initialValues?.name ?? '');
  const [startDate, setStartDate] = React.useState<Date | undefined>(initialValues?.startDate);
  const [endDate, setEndDate] = React.useState<Date | undefined>(initialValues?.endDate);
  const [isCurrent, setIsCurrent] = React.useState(initialValues?.isCurrent ?? false);
  const [validationError, setValidationError] = React.useState<string | null>(null);
  const [confirmingIsCurrent, setConfirmingIsCurrent] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    const values = initialValues ?? EMPTY_VALUES;
    setName(values.name);
    setStartDate(values.startDate);
    setEndDate(values.endDate);
    setIsCurrent(values.isCurrent);
    setValidationError(null);
    setConfirmingIsCurrent(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only on open/close transitions
  }, [open]);

  /** Checking the box unsets every other current academic year server-side
   * (`academic-year.service.ts`'s `create`/`update`) — same side effect
   * `SetCurrentDialog` requires explicit confirmation for. Route through
   * the same confirmation here rather than flipping `isCurrent` straight
   * from the checkbox, so this form can't bypass it. Unchecking has no
   * such side effect and stays a direct toggle. */
  function handleIsCurrentChange(checked: boolean) {
    if (checked) {
      setConfirmingIsCurrent(true);
      return;
    }
    setIsCurrent(false);
  }

  function handleConfirmIsCurrent() {
    setIsCurrent(true);
    setConfirmingIsCurrent(false);
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    if (name.trim() === '') {
      setValidationError(t('form.errorNameRequired'));
      return;
    }
    if (!startDate || !endDate) {
      setValidationError(t('form.errorDatesRequired'));
      return;
    }
    if (endDate <= startDate) {
      setValidationError(t('form.errorEndBeforeStart'));
      return;
    }

    setValidationError(null);
    onSubmit({
      name: name.trim(),
      start_date: toLocalDateString(startDate),
      end_date: toLocalDateString(endDate),
      is_current: isCurrent,
    });
  }

  const title = mode === 'create' ? t('form.createTitle') : t('form.editTitle');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{t('form.description')}</DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="year-form-name" className="text-sm font-medium">
              {t('form.nameLabel')}
            </label>
            <Input
              id="year-form-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t('form.namePlaceholder')}
            />
          </div>

          <div className="flex gap-3">
            <div className="flex flex-1 flex-col gap-1.5">
              <span className="text-sm font-medium">{t('form.startDateLabel')}</span>
              <DatePicker
                aria-label={t('form.startDateLabel')}
                config={regionConfig}
                value={startDate}
                onValueChange={setStartDate}
              />
            </div>
            <div className="flex flex-1 flex-col gap-1.5">
              <span className="text-sm font-medium">{t('form.endDateLabel')}</span>
              <DatePicker
                aria-label={t('form.endDateLabel')}
                config={regionConfig}
                value={endDate}
                onValueChange={setEndDate}
              />
            </div>
          </div>

          <div className="flex items-start gap-2">
            <Checkbox
              id="year-form-is-current"
              checked={isCurrent}
              onCheckedChange={(checked) => handleIsCurrentChange(checked === true)}
            />
            <label htmlFor="year-form-is-current" className="text-sm">
              {t('form.isCurrentLabel')}
            </label>
          </div>

          {confirmingIsCurrent && (
            <div className="rounded-md border border-border-subtle bg-muted p-3 text-sm">
              <p>{t('form.confirmIsCurrentDescription')}</p>
              <div className="mt-2 flex gap-2">
                <Button type="button" size="sm" onClick={handleConfirmIsCurrent}>
                  {t('form.confirmIsCurrentConfirm')}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setConfirmingIsCurrent(false)}
                >
                  {t('form.confirmIsCurrentCancel')}
                </Button>
              </div>
            </div>
          )}

          {validationError && (
            <p role="alert" className="text-sm text-destructive">
              {validationError}
            </p>
          )}
          {isError && (
            <p role="alert" className="text-sm text-destructive">
              {t('form.errorMessage')}
            </p>
          )}

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {t('actions.cancel', { ns: 'common' })}
              </Button>
            </DialogClose>
            <Button type="submit" loading={isPending}>
              {isPending ? t('form.saving') : t('form.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
