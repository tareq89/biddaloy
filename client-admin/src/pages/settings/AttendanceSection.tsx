/**
 * [9.10] The "Attendance" settings section — a UI over [9.2]'s already-
 * shipped `AttendancePolicyDto` (no schema change here, plan's own
 * scoping note). Same partial-save shape as every other section on this
 * page (`RegionalSection.tsx`, `SmsSection.tsx`, ...): its own `FormShell`
 * that PATCHes `{ version: 1, attendance: {...} }` only, never the whole
 * `TenantSettingsInput` — a save here can't clobber `communications`/
 * `region`, which is what "changed fields only" means at this page's
 * granularity (per-section, not per-field within a section — matching
 * every existing section here, which all resubmit their whole own slice).
 *
 * `autoAbsentNotification.enabled` gets an explicit confirm step before it
 * can be checked ([9.10]'s own acceptance criterion) — same inline
 * confirm-panel pattern `academic-years/-year-form-dialog.tsx` already
 * uses for `is_current` (a side-effecting checkbox), reused rather than a
 * second confirmation idiom. Unchecking has no such side effect and stays
 * a direct toggle, same asymmetry as that dialog's own comment explains.
 */
import {
  Button,
  Checkbox,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  Label,
} from '@biddaloy/ui/components';
import { useUpdateSchoolSettings, type AttendancePolicySettings } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import {
  FormSection,
  FormShell,
  buildFormShellErrors,
  useFormShellMode,
  useWarnUnsavedChanges,
} from '@biddaloy/ui/shells';
import { boundedNumericString } from '@biddaloy/ui/utils';
import { zodResolver } from '@hookform/resolvers/zod';
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { MutationErrorMessage } from '../../components/MutationErrorMessage';

const HH_MM_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const;

/** Literal per-day keys, not `t(\`attendance.weekday.${day}\`)` — a
 * computed key is invisible to `check-i18n-keys.mjs`, same reasoning
 * `attendance-month-grid.tsx`'s own `WEEKDAY_KEYS` documents. */
const WEEKDAY_LABEL_KEYS = [
  'attendance.weekday.0',
  'attendance.weekday.1',
  'attendance.weekday.2',
  'attendance.weekday.3',
  'attendance.weekday.4',
  'attendance.weekday.5',
  'attendance.weekday.6',
] as const;

const attendanceSchema = z.object({
  weeklyOff0: z.boolean(),
  weeklyOff1: z.boolean(),
  weeklyOff2: z.boolean(),
  weeklyOff3: z.boolean(),
  weeklyOff4: z.boolean(),
  weeklyOff5: z.boolean(),
  weeklyOff6: z.boolean(),
  lateAfter: z.string().regex(HH_MM_PATTERN),
  absentAfter: z.string().regex(HH_MM_PATTERN),
  correctionWindowDays: boundedNumericString(0, 365),
  lowAttendanceThresholdPercent: boundedNumericString(0, 100),
  lateCountsAsPresent: z.boolean(),
  leaveCountsAsWorkingDay: z.boolean(),
  allowFutureDates: z.boolean(),
  percentageDenominator: z.enum(['WORKING_DAYS', 'MARKED_DAYS']),
  autoAbsentEnabled: z.boolean(),
  autoAbsentCutoffTime: z.string().regex(HH_MM_PATTERN),
});

type AttendanceFormValues = z.infer<typeof attendanceSchema>;

interface AttendanceSectionProps {
  schoolId: string;
  attendance: AttendancePolicySettings | undefined;
}

const WEEKDAY_FIELD = [
  'weeklyOff0',
  'weeklyOff1',
  'weeklyOff2',
  'weeklyOff3',
  'weeklyOff4',
  'weeklyOff5',
  'weeklyOff6',
] as const;

const DEFAULT_VALUES: AttendanceFormValues = {
  weeklyOff0: true,
  weeklyOff1: false,
  weeklyOff2: false,
  weeklyOff3: false,
  weeklyOff4: false,
  weeklyOff5: false,
  weeklyOff6: true,
  lateAfter: '09:00',
  absentAfter: '09:30',
  correctionWindowDays: '3',
  lowAttendanceThresholdPercent: '75',
  lateCountsAsPresent: true,
  leaveCountsAsWorkingDay: true,
  allowFutureDates: false,
  percentageDenominator: 'WORKING_DAYS',
  autoAbsentEnabled: false,
  autoAbsentCutoffTime: '10:00',
};

function toFormValues(attendance: AttendancePolicySettings | undefined): AttendanceFormValues {
  if (!attendance) return DEFAULT_VALUES;
  const offDays = new Set(attendance.weeklyOffDays);
  const weekdayValues = Object.fromEntries(
    WEEKDAY_FIELD.map((field, day) => [field, offDays.has(day)]),
  ) as Pick<AttendanceFormValues, (typeof WEEKDAY_FIELD)[number]>;
  return {
    ...weekdayValues,
    lateAfter: attendance.lateAfter,
    absentAfter: attendance.absentAfter,
    correctionWindowDays: String(attendance.correctionWindowDays),
    lowAttendanceThresholdPercent: String(attendance.lowAttendanceThresholdPercent),
    lateCountsAsPresent: attendance.lateCountsAsPresent,
    leaveCountsAsWorkingDay: attendance.leaveCountsAsWorkingDay,
    allowFutureDates: attendance.allowFutureDates,
    percentageDenominator: attendance.percentageDenominator,
    autoAbsentEnabled: attendance.autoAbsentNotification.enabled,
    autoAbsentCutoffTime: attendance.autoAbsentNotification.cutoffTime,
  };
}

export function AttendanceSection({ schoolId, attendance }: AttendanceSectionProps) {
  const { t } = useTranslation('settings');
  const form = useForm<AttendanceFormValues>({
    resolver: zodResolver(attendanceSchema),
    defaultValues: toFormValues(attendance),
    ...useFormShellMode(),
  });
  const [confirmingAutoAbsent, setConfirmingAutoAbsent] = React.useState(false);

  // Not `isDirty && !isSubmitSuccessful` (the pattern most sibling
  // settings sections use): `handleSave` below calls `.mutate()` without
  // awaiting it, so React Hook Form marks the submit "successful" as soon
  // as that synchronous call returns — before the PATCH has actually
  // resolved. A failed save would then leave the form dirty with the
  // warning already suppressed. `isDirty` alone still clears correctly on
  // success, since the `onSuccess` callback calls `form.reset(values)`.
  useWarnUnsavedChanges(form.formState.isDirty);

  const updateSettings = useUpdateSchoolSettings(schoolId);

  function handleAutoAbsentChange(checked: boolean, onChange: (value: boolean) => void) {
    if (checked) {
      setConfirmingAutoAbsent(true);
      return;
    }
    onChange(false);
  }

  function handleConfirmAutoAbsent(onChange: (value: boolean) => void) {
    onChange(true);
    setConfirmingAutoAbsent(false);
  }

  function handleSave(values: AttendanceFormValues) {
    const policy: AttendancePolicySettings = {
      weeklyOffDays: WEEKDAY_FIELD.map((field, day) => (values[field] ? day : -1)).filter(
        (day) => day >= 0,
      ),
      lateAfter: values.lateAfter,
      absentAfter: values.absentAfter,
      correctionWindowDays: Number(values.correctionWindowDays),
      lowAttendanceThresholdPercent: Number(values.lowAttendanceThresholdPercent),
      lateCountsAsPresent: values.lateCountsAsPresent,
      leaveCountsAsWorkingDay: values.leaveCountsAsWorkingDay,
      allowFutureDates: values.allowFutureDates,
      percentageDenominator: values.percentageDenominator,
      autoAbsentNotification: {
        enabled: values.autoAbsentEnabled,
        cutoffTime: values.autoAbsentCutoffTime,
      },
    };
    updateSettings.mutate(
      { version: 1, attendance: policy },
      { onSuccess: () => form.reset(values, { keepIsSubmitSuccessful: true }) },
    );
  }

  const summaryErrors = buildFormShellErrors(
    form.formState.errors,
    (field) => `attendance-${field.replace(/\./g, '-')}`,
  );

  return (
    <Form {...form}>
      <FormShell
        errors={summaryErrors}
        submitCount={form.formState.submitCount}
        onSubmit={(event) => void form.handleSubmit(handleSave)(event)}
      >
        <FormSection legend={t('attendance.legend')}>
          <fieldset className="grid gap-1.5">
            <legend className="text-sm font-medium">{t('attendance.weeklyOffLegend')}</legend>
            <div className="flex flex-wrap gap-3">
              {WEEKDAYS.map((day) => (
                <FormField
                  key={day}
                  control={form.control}
                  name={WEEKDAY_FIELD[day]}
                  render={({ field }) => (
                    <FormItem className="flex items-center gap-1.5">
                      <FormControl>
                        <Checkbox
                          id={`attendance-weekly-off-${day}`}
                          checked={field.value}
                          onCheckedChange={(checked) => field.onChange(checked === true)}
                        />
                      </FormControl>
                      <FormLabel htmlFor={`attendance-weekly-off-${day}`} className="text-sm">
                        {t(WEEKDAY_LABEL_KEYS[day])}
                      </FormLabel>
                    </FormItem>
                  )}
                />
              ))}
            </div>
          </fieldset>

          <FormField
            control={form.control}
            name="lateAfter"
            render={({ field }) => (
              <FormItem>
                <FormLabel htmlFor="attendance-lateAfter">{t('attendance.lateAfter')}</FormLabel>
                <FormControl>
                  <Input id="attendance-lateAfter" type="time" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="absentAfter"
            render={({ field }) => (
              <FormItem>
                <FormLabel htmlFor="attendance-absentAfter">
                  {t('attendance.absentAfter')}
                </FormLabel>
                <FormControl>
                  <Input id="attendance-absentAfter" type="time" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="correctionWindowDays"
            render={({ field }) => (
              <FormItem>
                <FormLabel htmlFor="attendance-correctionWindowDays">
                  {t('attendance.correctionWindowDays')}
                </FormLabel>
                <FormControl>
                  <Input
                    id="attendance-correctionWindowDays"
                    type="number"
                    min={0}
                    max={365}
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="lowAttendanceThresholdPercent"
            render={({ field }) => (
              <FormItem>
                <FormLabel htmlFor="attendance-lowAttendanceThresholdPercent">
                  {t('attendance.lowAttendanceThresholdPercent')}
                </FormLabel>
                <FormControl>
                  <Input
                    id="attendance-lowAttendanceThresholdPercent"
                    type="number"
                    min={0}
                    max={100}
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="percentageDenominator"
            render={({ field }) => (
              <FormItem>
                <FormLabel htmlFor="attendance-percentageDenominator">
                  {t('attendance.percentageDenominator')}
                </FormLabel>
                <FormControl>
                  <select
                    id="attendance-percentageDenominator"
                    className="h-8 rounded-md border border-input bg-card px-2.5 text-sm"
                    {...field}
                  >
                    <option value="WORKING_DAYS">
                      {t('attendance.percentageDenominatorWorkingDays')}
                    </option>
                    <option value="MARKED_DAYS">
                      {t('attendance.percentageDenominatorMarkedDays')}
                    </option>
                  </select>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="lateCountsAsPresent"
            render={({ field }) => (
              <FormItem className="flex items-center gap-2">
                <FormControl>
                  <Checkbox
                    id="attendance-lateCountsAsPresent"
                    checked={field.value}
                    onCheckedChange={(checked) => field.onChange(checked === true)}
                  />
                </FormControl>
                <FormLabel htmlFor="attendance-lateCountsAsPresent">
                  {t('attendance.lateCountsAsPresent')}
                </FormLabel>
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="leaveCountsAsWorkingDay"
            render={({ field }) => (
              <FormItem className="flex items-center gap-2">
                <FormControl>
                  <Checkbox
                    id="attendance-leaveCountsAsWorkingDay"
                    checked={field.value}
                    onCheckedChange={(checked) => field.onChange(checked === true)}
                  />
                </FormControl>
                <FormLabel htmlFor="attendance-leaveCountsAsWorkingDay">
                  {t('attendance.leaveCountsAsWorkingDay')}
                </FormLabel>
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="allowFutureDates"
            render={({ field }) => (
              <FormItem className="flex items-center gap-2">
                <FormControl>
                  <Checkbox
                    id="attendance-allowFutureDates"
                    checked={field.value}
                    onCheckedChange={(checked) => field.onChange(checked === true)}
                  />
                </FormControl>
                <FormLabel htmlFor="attendance-allowFutureDates">
                  {t('attendance.allowFutureDates')}
                </FormLabel>
              </FormItem>
            )}
          />
        </FormSection>

        <FormSection legend={t('attendance.autoAbsentLegend')}>
          <FormField
            control={form.control}
            name="autoAbsentEnabled"
            render={({ field }) => (
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="attendance-autoAbsentEnabled"
                    checked={field.value}
                    onCheckedChange={(checked) =>
                      handleAutoAbsentChange(checked === true, field.onChange)
                    }
                  />
                  <Label htmlFor="attendance-autoAbsentEnabled">
                    {t('attendance.autoAbsentEnabled')}
                  </Label>
                </div>
                {confirmingAutoAbsent && (
                  <div className="rounded-md border border-border-subtle bg-muted p-3 text-sm">
                    <p>{t('attendance.confirmEnableNotificationDescription')}</p>
                    <div className="mt-2 flex gap-2">
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => handleConfirmAutoAbsent(field.onChange)}
                      >
                        {t('attendance.confirmEnableNotificationConfirm')}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => setConfirmingAutoAbsent(false)}
                      >
                        {t('attendance.confirmEnableNotificationCancel')}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}
          />
          <FormField
            control={form.control}
            name="autoAbsentCutoffTime"
            render={({ field }) => (
              <FormItem>
                <FormLabel htmlFor="attendance-autoAbsentCutoffTime">
                  {t('attendance.autoAbsentCutoffTime')}
                </FormLabel>
                <FormControl>
                  <Input id="attendance-autoAbsentCutoffTime" type="time" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </FormSection>

        <Button type="submit" loading={updateSettings.isPending}>
          {t('save.action')}
        </Button>
        {updateSettings.isSuccess && <p role="status">{t('save.success')}</p>}
        {updateSettings.isError && <MutationErrorMessage error={updateSettings.error} />}
      </FormShell>
    </Form>
  );
}
