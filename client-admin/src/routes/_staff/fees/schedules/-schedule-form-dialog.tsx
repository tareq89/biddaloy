/**
 * [16.7.5] Create/Edit recurring-schedule dialog. Tier B form (plain
 * `useState`, no `FormShell`/react-hook-form), same call as `fee-
 * structures/-structure-form-dialog.tsx` — this modal's field count
 * doesn't earn react-hook-form's autosave/unsaved-changes machinery
 * either.
 *
 * Audience/rule follow issue #679's Step 2: monthly day-of-month (1-28 or
 * "Last"), weekly weekday chips (ISO numbers, 1 = Monday .. 7 = Sunday),
 * ends-on capped to the selected academic year's end date.
 *
 * Two of #679's Step 2 controls are gone because the shipped server
 * contract (#675) does not back them:
 *
 * - The "active students only" checkbox. `RecurringScheduleAudienceDto`
 *   has a required `enrollment_status` whose only accepted value is
 *   `'ACTIVE'`, so every schedule is active-students-only and the toggle
 *   offered a choice that did not exist. The form now always sends
 *   `enrollment_status: 'ACTIVE'` and the audience summary states it.
 * - The live "preview matching students" button in create mode. The only
 *   preview endpoint is `GET /fees/schedules/:id/preview`, which needs a
 *   saved schedule, so preview is edit-mode only.
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@biddaloy/ui/components';
import {
  useAcademicYears,
  useClasses,
  useClassSections,
  useCreateRecurringSchedule,
  useFeeStructures,
  useSchedulePreview,
  useUpdateRecurringSchedule,
  ISO_WEEKDAYS,
  type CreateRecurringScheduleInput,
  type MonthlyRuleDay,
  type RecurringSchedule,
  type Weekday,
} from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatDate, parseServerDate } from '@biddaloy/ui/utils';
import * as React from 'react';

const NO_CLASS = '__none__';
const NO_SECTION = '__none__';
const WEEKDAYS: Weekday[] = ISO_WEEKDAYS;
const DAY_OF_MONTH_OPTIONS: MonthlyRuleDay[] = [
  ...Array.from({ length: 28 }, (_, i) => i + 1),
  'LAST',
];

export interface ScheduleFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'create' | 'edit';
  schedule?: RecurringSchedule;
  onSaved: () => void;
}

function toDateInput(date: Date): string {
  // `DatePicker` builds this `Date` from local calendar fields (year/month/
  // day the user actually picked). `toISOString()` converts through UTC
  // first — in Asia/Dhaka (UTC+6), local midnight is 18:00 UTC the
  // *previous* day, so slicing its ISO string silently submits a date one
  // day earlier than what's shown in the picker. Read the local fields
  // back out directly instead, same as `reports/collections.tsx`'s
  // `dhakaNow`/`startOfUtcDay` convention for never letting a date-only
  // value round-trip through a timezone conversion.
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function ScheduleFormDialog({
  open,
  onOpenChange,
  mode,
  schedule,
  onSaved,
}: ScheduleFormDialogProps) {
  const { t } = useTranslation('fees');
  const regionConfig = useRegionConfig();

  const createSchedule = useCreateRecurringSchedule();
  const updateSchedule = useUpdateRecurringSchedule(schedule?.id ?? '');
  const mutation = mode === 'create' ? createSchedule : updateSchedule;
  // Preview needs a saved schedule (`GET /fees/schedules/:id/preview`), so
  // it is edit-mode only and shows the audience as it is currently *saved*,
  // not as it is being edited. Fetched lazily, on the button press.
  const [previewRequested, setPreviewRequested] = React.useState(false);
  const previewQuery = useSchedulePreview(schedule?.id, {
    enabled: open && mode === 'edit' && previewRequested,
  });

  const yearsQuery = useAcademicYears();

  const [name, setName] = React.useState(schedule?.name ?? '');
  const [academicYearId, setAcademicYearId] = React.useState(schedule?.academic_year_id ?? '');
  const [feeIds, setFeeIds] = React.useState<string[]>(schedule?.fee_structure_ids ?? []);
  const [classId, setClassId] = React.useState(schedule?.audience.class_id ?? '');
  const [sectionId, setSectionId] = React.useState(schedule?.audience.section_id ?? '');
  const [ruleKind, setRuleKind] = React.useState<'MONTHLY' | 'WEEKLY'>(
    schedule?.rule.kind ?? 'MONTHLY',
  );
  const [dayOfMonth, setDayOfMonth] = React.useState<MonthlyRuleDay>(
    schedule?.rule.day_of_month ?? 1,
  );
  const [weekdays, setWeekdays] = React.useState<Weekday[]>(schedule?.rule.weekdays ?? []);
  const [dueDays, setDueDays] = React.useState(schedule?.due_days_after_period_start ?? 7);
  const [startsOn, setStartsOn] = React.useState<Date | undefined>(
    schedule ? parseServerDate(schedule.starts_on) : new Date(),
  );
  const [endsOn, setEndsOn] = React.useState<Date | undefined>(
    schedule?.ends_on ? parseServerDate(schedule.ends_on) : undefined,
  );
  const [notifyFamilies, setNotifyFamilies] = React.useState(schedule?.notify_families ?? false);
  const [validationError, setValidationError] = React.useState<string | null>(null);

  const feesQuery = useFeeStructures(
    academicYearId !== '' ? { academic_year_id: academicYearId } : {},
  );
  const classesQuery = useClasses(
    academicYearId !== '' ? { academic_year_id: academicYearId } : {},
  );
  const sectionsQuery = useClassSections(classId !== '' ? classId : undefined);

  const selectedYear = yearsQuery.data?.data.find((year) => year.id === academicYearId);
  const yearEndDate = selectedYear ? parseServerDate(selectedYear.end_date) : undefined;

  // Reset only on open/close transitions — matches
  // `-structure-form-dialog.tsx`'s identical reasoning: a background
  // refetch of the list this dialog was opened from must not clobber
  // what the user is mid-typing.
  React.useEffect(() => {
    if (!open) return;
    mutation.reset();
    setPreviewRequested(false);
    setName(schedule?.name ?? '');
    setAcademicYearId(schedule?.academic_year_id ?? '');
    setFeeIds(schedule?.fee_structure_ids ?? []);
    setClassId(schedule?.audience.class_id ?? '');
    setSectionId(schedule?.audience.section_id ?? '');
    setRuleKind(schedule?.rule.kind ?? 'MONTHLY');
    setDayOfMonth(schedule?.rule.day_of_month ?? 1);
    setWeekdays(schedule?.rule.weekdays ?? []);
    setDueDays(schedule?.due_days_after_period_start ?? 7);
    setStartsOn(schedule ? parseServerDate(schedule.starts_on) : new Date());
    setEndsOn(schedule?.ends_on ? parseServerDate(schedule.ends_on) : undefined);
    setNotifyFamilies(schedule?.notify_families ?? false);
    setValidationError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only on open/close transitions
  }, [open]);

  // Ends-on capped to the selected academic year's end date — issue
  // #679's own acceptance criterion. Clamping here (rather than just
  // disabling later dates in the picker) keeps a year-switch from
  // silently leaving a now-invalid `endsOn` behind.
  React.useEffect(() => {
    if (!yearEndDate || !endsOn) return;
    if (endsOn > yearEndDate) setEndsOn(yearEndDate);
  }, [yearEndDate, endsOn]);

  function toggleWeekday(day: Weekday) {
    setWeekdays((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]));
  }

  function buildInput(): CreateRecurringScheduleInput | null {
    if (name.trim() === '') {
      setValidationError(t('schedules.form.nameRequired'));
      return null;
    }
    if (feeIds.length === 0) {
      setValidationError(t('schedules.form.feesRequired'));
      return null;
    }
    if (ruleKind === 'WEEKLY' && weekdays.length === 0) {
      setValidationError(t('schedules.form.weekdaysRequired'));
      return null;
    }
    setValidationError(null);
    return {
      name: name.trim(),
      academic_year_id: academicYearId,
      fee_structure_ids: feeIds,
      // `class_id`/`section_id` are `@IsOptional() @IsUUID()` — an explicit
      // `null` fails UUID validation, so "all classes" omits the key
      // entirely rather than sending null. `enrollment_status` is required
      // and `'ACTIVE'` is its only accepted value today.
      audience: {
        ...(classId !== '' ? { class_id: classId } : {}),
        ...(sectionId !== '' ? { section_id: sectionId } : {}),
        enrollment_status: 'ACTIVE' as const,
      },
      rule:
        ruleKind === 'MONTHLY'
          ? { kind: 'MONTHLY' as const, day_of_month: dayOfMonth }
          : { kind: 'WEEKLY' as const, weekdays },
      due_days_after_period_start: dueDays,
      starts_on: toDateInput(startsOn ?? new Date()),
      ...(endsOn ? { ends_on: toDateInput(endsOn) } : {}),
      notify_families: notifyFamilies,
      // No control for this in the dialog — activate/deactivate is a row
      // action on the list. Preserve it on edit, default on to create.
      is_active: schedule?.is_active ?? true,
    };
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const input = buildInput();
    if (!input) return;
    if (mode === 'create') {
      createSchedule.mutate(input, { onSuccess: onSaved });
      return;
    }
    updateSchedule.mutate(input, { onSuccess: onSaved });
  }

  function handlePreview() {
    setPreviewRequested(true);
  }

  const isEdit = mode === 'edit';
  const title = isEdit ? t('schedules.form.editTitle') : t('schedules.form.createTitle');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{t('schedules.form.description')}</DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="schedule-form-name" className="text-sm font-medium">
              {t('schedules.form.nameLabel')}
            </label>
            <Input
              id="schedule-form-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">{t('schedules.form.academicYearLabel')}</span>
            <Select value={academicYearId} onValueChange={setAcademicYearId} disabled={isEdit}>
              <SelectTrigger aria-label={t('schedules.form.academicYearLabel')} disabled={isEdit}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {yearsQuery.data?.data.map((year) => (
                  <SelectItem key={year.id} value={year.id}>
                    {year.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <fieldset className="flex flex-col gap-2 rounded-lg border border-border-subtle p-3">
            <legend className="px-1 text-sm font-medium">{t('schedules.form.feesLabel')}</legend>
            <ul className="flex max-h-40 flex-col gap-1 overflow-y-auto">
              {(feesQuery.data?.data ?? []).map((fee) => (
                <li key={fee.id} className="flex items-center gap-2">
                  <Checkbox
                    checked={feeIds.includes(fee.id)}
                    onCheckedChange={(checked) =>
                      setFeeIds((prev) =>
                        checked === true ? [...prev, fee.id] : prev.filter((id) => id !== fee.id),
                      )
                    }
                    aria-label={fee.name}
                  />
                  <span className="text-sm">{fee.name}</span>
                </li>
              ))}
            </ul>
          </fieldset>

          <fieldset className="flex flex-col gap-3 rounded-lg border border-border-subtle p-3">
            <legend className="px-1 text-sm font-medium">
              {t('schedules.form.audienceLegend')}
            </legend>
            <div className="flex flex-wrap gap-2">
              <Select
                value={classId === '' ? NO_CLASS : classId}
                onValueChange={(value) => {
                  setClassId(value === NO_CLASS ? '' : value);
                  setSectionId('');
                }}
              >
                <SelectTrigger aria-label={t('schedules.form.classLabel')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_CLASS}>{t('schedules.form.allClasses')}</SelectItem>
                  {classesQuery.data?.data.map((klass) => (
                    <SelectItem key={klass.id} value={klass.id}>
                      {klass.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {classId !== '' && (
                <Select
                  value={sectionId === '' ? NO_SECTION : sectionId}
                  onValueChange={(value) => setSectionId(value === NO_SECTION ? '' : value)}
                >
                  <SelectTrigger aria-label={t('schedules.form.sectionLabel')}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_SECTION}>{t('schedules.form.allSections')}</SelectItem>
                    {sectionsQuery.data?.map((section) => (
                      <SelectItem key={section.id} value={section.id}>
                        {section.section_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            {/* Not a control: `enrollment_status` accepts only `'ACTIVE'`,
                so this states the fixed rule instead of offering a choice
                the server would reject. */}
            <p className="text-xs text-muted-foreground">{t('schedules.form.activeOnlyNotice')}</p>
          </fieldset>

          <fieldset className="flex flex-col gap-3 rounded-lg border border-border-subtle p-3">
            <legend className="px-1 text-sm font-medium">{t('schedules.form.ruleLegend')}</legend>
            <Select
              value={ruleKind}
              onValueChange={(value) => setRuleKind(value as 'MONTHLY' | 'WEEKLY')}
            >
              <SelectTrigger aria-label={t('schedules.form.ruleLegend')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="MONTHLY">{t('schedules.form.ruleModeMonthly')}</SelectItem>
                <SelectItem value="WEEKLY">{t('schedules.form.ruleModeWeekly')}</SelectItem>
              </SelectContent>
            </Select>

            {ruleKind === 'MONTHLY' ? (
              <Select
                value={String(dayOfMonth)}
                onValueChange={(value) => setDayOfMonth(value === 'LAST' ? 'LAST' : Number(value))}
              >
                <SelectTrigger aria-label={t('schedules.form.dayOfMonthLabel')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DAY_OF_MONTH_OPTIONS.map((day) => (
                    <SelectItem key={day} value={String(day)}>
                      {day === 'LAST' ? t('schedules.form.dayOfMonthLast') : day}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <div
                className="flex flex-wrap gap-2"
                role="group"
                aria-label={t('schedules.form.weekdaysLabel')}
              >
                {WEEKDAYS.map((day) => {
                  const selected = weekdays.includes(day);
                  return (
                    <button
                      key={day}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => toggleWeekday(day)}
                      className={`rounded-full border px-3 py-1 text-sm ${
                        selected
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-border-subtle'
                      }`}
                    >
                      {t(`weekdays.${day}`, { ns: 'common', defaultValue: String(day) })}
                    </button>
                  );
                })}
              </div>
            )}

            <div className="flex flex-col gap-1.5">
              <label htmlFor="schedule-form-due-days" className="text-sm font-medium">
                {t('schedules.form.dueDaysLabel')}
              </label>
              <Input
                id="schedule-form-due-days"
                type="number"
                min={0}
                value={dueDays}
                onChange={(event) => setDueDays(Number(event.target.value))}
              />
            </div>
          </fieldset>

          <div className="flex flex-wrap gap-3">
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">{t('schedules.form.startsOnLabel')}</span>
              <DatePicker
                value={startsOn}
                onValueChange={setStartsOn}
                config={regionConfig}
                aria-label={t('schedules.form.startsOnLabel')}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">{t('schedules.form.endsOnLabel')}</span>
              <DatePicker
                value={endsOn}
                onValueChange={(date) =>
                  setEndsOn(date && yearEndDate && date > yearEndDate ? yearEndDate : date)
                }
                config={regionConfig}
                aria-label={t('schedules.form.endsOnLabel')}
              />
              {yearEndDate && (
                <p className="text-xs text-muted-foreground">
                  {t('schedules.form.endsOnCappedNotice')} ({formatDate(yearEndDate, regionConfig)})
                </p>
              )}
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={notifyFamilies}
              onCheckedChange={(checked) => setNotifyFamilies(checked === true)}
              aria-label={t('schedules.form.notifyFamiliesLabel')}
            />
            {t('schedules.form.notifyFamiliesLabel')}
          </label>

          {isEdit && (
            <div className="flex items-center justify-between rounded-lg border border-border-subtle p-3">
              <span className="text-sm">
                {previewQuery.isFetching
                  ? t('schedules.form.saving')
                  : previewQuery.data
                    ? t('schedules.form.previewLabel', {
                        count: previewQuery.data.total_count,
                      })
                    : previewQuery.isError
                      ? t('schedules.form.previewError')
                      : t('schedules.form.previewSavedOnlyNotice')}
              </span>
              <Button type="button" variant="outline" size="sm" onClick={handlePreview}>
                {t('schedules.form.previewButton')}
              </Button>
            </div>
          )}

          {validationError && (
            <p role="alert" className="text-sm text-destructive">
              {validationError}
            </p>
          )}
          {mutation.isError && (
            <p role="alert" className="text-sm text-destructive">
              {t('schedules.form.errorMessage')}
            </p>
          )}

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {t('schedules.form.cancel')}
              </Button>
            </DialogClose>
            <Button type="submit" loading={mutation.isPending}>
              {mutation.isPending ? t('schedules.form.saving') : t('schedules.form.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
