/**
 * [17.4.2] Create/edit calendar event dialog. Local `useState`, same
 * weight-class reasoning as `academic-years/-year-form-dialog.tsx` — a
 * handful of fields, no autosave/unsaved-changes machinery needed.
 *
 * Server 422s (`CALENDAR_EVENT_LOCKED`, `CALENDAR_OUTSIDE_ACADEMIC_YEAR`,
 * `CALENDAR_DAY_HAS_ATTENDANCE`, `CALENDAR_INVALID_CLASS`,
 * `CALENDAR_INVALID_RANGE`) are mapped by `error.details.code` to a
 * translated message — see `calendar.json`'s `eventForm.errors`.
 */
import { CalendarEventType } from '@biddaloy/shared';
import { ApiError } from '@biddaloy/ui/api';
import {
  Button,
  Checkbox,
  DatePicker,
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from '@biddaloy/ui/components';
import type { CalendarEvent } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

export interface EventFormPayload {
  type: CalendarEventType;
  name: string;
  description?: string | undefined;
  start_date: string;
  end_date: string;
  counts_as_working_day?: boolean | undefined;
  publish: boolean;
  notify?: boolean | undefined;
  notify_sms?: boolean | undefined;
}

export interface EventFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'create' | 'edit';
  initialValues?: CalendarEvent | undefined;
  isPending: boolean;
  error: unknown;
  onSubmit: (payload: EventFormPayload) => void;
}

function toDateOnly(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`;
}

function parseDateOnly(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const parts = value.split('-').map(Number);
  const y = parts[0] ?? 0;
  const m = parts[1] ?? 1;
  const d = parts[2] ?? 1;
  return new Date(y, m - 1, d);
}

const KNOWN_ERROR_CODES = [
  'CALENDAR_EVENT_LOCKED',
  'CALENDAR_OUTSIDE_ACADEMIC_YEAR',
  'CALENDAR_DAY_HAS_ATTENDANCE',
  'CALENDAR_INVALID_CLASS',
  'CALENDAR_INVALID_RANGE',
] as const;

export function EventFormDialog({
  open,
  onOpenChange,
  mode,
  initialValues,
  isPending,
  error,
  onSubmit,
}: EventFormDialogProps) {
  const { t } = useTranslation('calendar');
  const regionConfig = useRegionConfig();

  const [type, setType] = React.useState<CalendarEventType>(
    initialValues?.type ?? CalendarEventType.EVENT,
  );
  const [name, setName] = React.useState(initialValues?.name ?? '');
  const [description, setDescription] = React.useState(initialValues?.description ?? '');
  const [startDate, setStartDate] = React.useState<Date | undefined>(
    parseDateOnly(initialValues?.start_date),
  );
  const [endDate, setEndDate] = React.useState<Date | undefined>(
    parseDateOnly(initialValues?.end_date),
  );
  const [countsAsWorkingDay, setCountsAsWorkingDay] = React.useState(
    initialValues?.counts_as_working_day ?? true,
  );
  const [publish, setPublish] = React.useState(true);
  const [notify, setNotify] = React.useState(false);
  const [notifySms, setNotifySms] = React.useState(false);
  const [validationError, setValidationError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setType(initialValues?.type ?? CalendarEventType.EVENT);
    setName(initialValues?.name ?? '');
    setDescription(initialValues?.description ?? '');
    setStartDate(parseDateOnly(initialValues?.start_date));
    setEndDate(parseDateOnly(initialValues?.end_date));
    setCountsAsWorkingDay(initialValues?.counts_as_working_day ?? true);
    setPublish(initialValues?.published ?? true);
    setNotify(false);
    setNotifySms(false);
    setValidationError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only on open/close
  }, [open]);

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) {
      setValidationError(t('eventForm.errors.generic'));
      return;
    }
    if (!startDate || !endDate) {
      setValidationError(t('eventForm.errors.CALENDAR_INVALID_RANGE'));
      return;
    }
    setValidationError(null);
    onSubmit({
      type,
      name: name.trim(),
      description: description.trim() || undefined,
      start_date: toDateOnly(startDate),
      end_date: toDateOnly(endDate),
      counts_as_working_day: countsAsWorkingDay,
      publish,
      notify,
      notify_sms: notifySms,
    });
  }

  const errorCode =
    error instanceof ApiError && typeof error.details?.code === 'string'
      ? error.details.code
      : undefined;
  const errorMessage = validationError
    ? validationError
    : error
      ? t(
          `eventForm.errors.${
            errorCode && (KNOWN_ERROR_CODES as readonly string[]).includes(errorCode)
              ? errorCode
              : 'generic'
          }`,
        )
      : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>
              {mode === 'create' ? t('eventForm.createTitle') : t('eventForm.editTitle')}
            </DialogTitle>
          </DialogHeader>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="event-form-type" className="text-sm font-medium">
              {t('eventForm.type')}
            </label>
            <Select value={type} onValueChange={(value) => setType(value as CalendarEventType)}>
              <SelectTrigger id="event-form-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.values(CalendarEventType).map((value) => (
                  <SelectItem key={value} value={value}>
                    {t(`types.${value}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="event-form-name" className="text-sm font-medium">
              {t('eventForm.name')}
            </label>
            <Input
              id="event-form-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="event-form-description" className="text-sm font-medium">
              {t('eventForm.description')}
            </label>
            <Textarea
              id="event-form-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>

          <div className="flex gap-3">
            <div className="flex flex-1 flex-col gap-1.5">
              <span className="text-sm font-medium">{t('eventForm.startDate')}</span>
              <DatePicker
                aria-label={t('eventForm.startDate')}
                config={regionConfig}
                value={startDate}
                onValueChange={setStartDate}
              />
            </div>
            <div className="flex flex-1 flex-col gap-1.5">
              <span className="text-sm font-medium">{t('eventForm.endDate')}</span>
              <DatePicker
                aria-label={t('eventForm.endDate')}
                config={regionConfig}
                value={endDate}
                onValueChange={setEndDate}
              />
            </div>
          </div>

          <div className="flex items-start gap-2">
            <Checkbox
              id="event-form-working-day"
              checked={countsAsWorkingDay}
              onCheckedChange={(checked) => setCountsAsWorkingDay(checked === true)}
            />
            <label htmlFor="event-form-working-day" className="text-sm">
              {t('eventForm.countsAsWorkingDay')}
            </label>
          </div>

          <div className="flex items-start gap-2">
            <Checkbox
              id="event-form-publish"
              checked={publish}
              onCheckedChange={(checked) => setPublish(checked === true)}
            />
            <label htmlFor="event-form-publish" className="text-sm">
              {t('eventForm.publishNow')}
            </label>
          </div>

          <div className="flex items-start gap-2">
            <Checkbox
              id="event-form-notify"
              checked={notify}
              onCheckedChange={(checked) => setNotify(checked === true)}
            />
            <label htmlFor="event-form-notify" className="text-sm">
              {t('eventForm.notify')}
            </label>
          </div>

          <div className="flex items-start gap-2">
            <Checkbox
              id="event-form-notify-sms"
              checked={notifySms}
              onCheckedChange={(checked) => setNotifySms(checked === true)}
              disabled={!notify}
            />
            <label htmlFor="event-form-notify-sms" className="text-sm">
              {t('eventForm.notifySms')}
            </label>
          </div>

          {errorMessage && (
            <p role="alert" className="text-sm text-destructive">
              {errorMessage}
            </p>
          )}

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {t('eventForm.cancel')}
              </Button>
            </DialogClose>
            <Button type="submit" loading={isPending}>
              {t('eventForm.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
