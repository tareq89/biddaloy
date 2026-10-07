/**
 * [9.10] The "Attendance" settings section — a UI over [9.2]'s already-
 * shipped `AttendancePolicyDto` (no schema change here, plan's own
 * scoping note). Same partial-save shape as every other section on this
 * page (`RegionalSection.tsx`, `SmsSection.tsx`, ...): its own
 * `SettingsSection` card that PATCHes `{ version: 1, attendance: {...} }` only, never the whole
 * `TenantSettingsInput` — a save here can't clobber `communications`/
 * `region`, which is what "changed fields only" means at this page's
 * granularity (per-section, not per-field within a section — matching
 * every existing section here, which all resubmit their whole own slice).
 *
 * `autoAbsentNotification.enabled` gets an explicit confirm step before it
 * can be checked ([9.10]'s own acceptance criterion): a `ConfirmDialog`
 * (D29). Unchecking has no such side effect and stays a direct toggle.
 */
import {
  Checkbox,
  ConfirmDialog,
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  TimeInput,
} from '@biddaloy/ui/components';
import { useUpdateSchoolSettings, type AttendancePolicySettings } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { useFormShellMode, useWarnUnsavedChanges } from '@biddaloy/ui/shells';
import { zodResolver } from '@hookform/resolvers/zod';
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { latinBounded } from './latin-digits';
import { SettingsSaved, SettingsSection } from './settings-layout';
import { SettingsMutationError } from './settings-mutation-error';

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
  correctionWindowDays: latinBounded(0, 365),
  lowAttendanceThresholdPercent: latinBounded(0, 100),
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

  const weekdayField = (day: (typeof WEEKDAYS)[number]) => (
    <FormField
      key={day}
      control={form.control}
      name={WEEKDAY_FIELD[day]}
      render={({ field }) => (
        <FormItem className="flex min-h-11 flex-row items-center gap-3 md:min-h-8">
          <FormControl>
            <Checkbox
              id={`attendance-weekly-off-${day}`}
              checked={field.value}
              onCheckedChange={(checked) => field.onChange(checked === true)}
            />
          </FormControl>
          <FormLabel htmlFor={`attendance-weekly-off-${day}`} className="flex-1 self-stretch">
            {t(WEEKDAY_LABEL_KEYS[day])}
          </FormLabel>
        </FormItem>
      )}
    />
  );

  const timeField = (name: 'lateAfter' | 'absentAfter' | 'autoAbsentCutoffTime', label: string) => (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel htmlFor={`attendance-${name}`}>{label}</FormLabel>
          <TimeInput
            id={`attendance-${name}`}
            aria-label={label}
            value={field.value}
            onValueChange={field.onChange}
          />
          <FormMessage />
        </FormItem>
      )}
    />
  );

  const numberField = (
    name: 'correctionWindowDays' | 'lowAttendanceThresholdPercent',
    label: string,
    help: string,
  ) => (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel htmlFor={`attendance-${name}`}>{label}</FormLabel>
          <FormControl>
            <Input id={`attendance-${name}`} inputMode="numeric" {...field} />
          </FormControl>
          <FormDescription>{help}</FormDescription>
          <FormMessage />
        </FormItem>
      )}
    />
  );

  const checkboxField = (
    name: 'lateCountsAsPresent' | 'leaveCountsAsWorkingDay' | 'allowFutureDates',
    label: string,
  ) => (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem className="flex min-h-11 flex-row items-center gap-3 md:col-span-2 md:min-h-8">
          <FormControl>
            <Checkbox
              id={`attendance-${name}`}
              checked={field.value}
              onCheckedChange={(checked) => field.onChange(checked === true)}
            />
          </FormControl>
          <FormLabel htmlFor={`attendance-${name}`} className="flex-1 self-stretch">
            {label}
          </FormLabel>
        </FormItem>
      )}
    />
  );

  return (
    <Form {...form}>
      <SettingsSection
        id="attendance-section"
        title={t('attendance.legend')}
        description={t('attendance.description')}
        onSubmit={(event) => void form.handleSubmit(handleSave)(event)}
        saving={updateSettings.isPending}
        footerStart={
          <>
            {updateSettings.isSuccess && <SettingsSaved />}
            {updateSettings.isError && <SettingsMutationError error={updateSettings.error} />}
          </>
        }
      >
        <fieldset className="mt-4">
          <legend className="text-label text-text-primary">
            {t('attendance.weeklyOffLegend')}
          </legend>
          <div className="mt-1.5 grid grid-cols-2 gap-x-4 md:flex md:flex-wrap md:gap-x-6">
            {WEEKDAYS.map((day) => weekdayField(day))}
          </div>
        </fieldset>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {timeField('lateAfter', t('attendance.lateAfter'))}
          {timeField('absentAfter', t('attendance.absentAfter'))}
          {numberField(
            'correctionWindowDays',
            t('attendance.correctionWindowDays'),
            t('attendance.correctionWindowHelp'),
          )}
          {numberField(
            'lowAttendanceThresholdPercent',
            t('attendance.lowAttendanceThresholdPercent'),
            t('attendance.lowAttendanceHelp'),
          )}
          <FormField
            control={form.control}
            name="percentageDenominator"
            render={({ field }) => (
              <FormItem className="md:col-span-2">
                <FormLabel htmlFor="attendance-percentageDenominator">
                  {t('attendance.percentageDenominator')}
                </FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger id="attendance-percentageDenominator">
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="WORKING_DAYS">
                      {t('attendance.percentageDenominatorWorkingDays')}
                    </SelectItem>
                    <SelectItem value="MARKED_DAYS">
                      {t('attendance.percentageDenominatorMarkedDays')}
                    </SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
          {checkboxField('lateCountsAsPresent', t('attendance.lateCountsAsPresent'))}
          {checkboxField('leaveCountsAsWorkingDay', t('attendance.leaveCountsAsWorkingDay'))}
          {checkboxField('allowFutureDates', t('attendance.allowFutureDates'))}
        </div>

        <h3 className="mt-6 border-t border-border-subtle pt-4 text-h3">
          {t('attendance.autoAbsentLegend')}
        </h3>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <FormField
            control={form.control}
            name="autoAbsentEnabled"
            render={({ field }) => (
              <FormItem className="flex min-h-11 flex-row items-center gap-3 md:col-span-2 md:min-h-8">
                <FormControl>
                  <Checkbox
                    id="attendance-autoAbsentEnabled"
                    checked={field.value}
                    onCheckedChange={(checked) =>
                      handleAutoAbsentChange(checked === true, field.onChange)
                    }
                  />
                </FormControl>
                <FormLabel htmlFor="attendance-autoAbsentEnabled" className="flex-1 self-stretch">
                  {t('attendance.autoAbsentEnabled')}
                </FormLabel>
                <ConfirmDialog
                  open={confirmingAutoAbsent}
                  onOpenChange={setConfirmingAutoAbsent}
                  title={t('attendance.confirmEnableNotificationTitle')}
                  description={t('attendance.confirmEnableNotificationDescription')}
                  confirmLabel={t('attendance.confirmEnableNotificationConfirm')}
                  cancelLabel={t('attendance.confirmEnableNotificationCancel')}
                  tone="default"
                  onConfirm={() => handleConfirmAutoAbsent(field.onChange)}
                />
              </FormItem>
            )}
          />
          {timeField('autoAbsentCutoffTime', t('attendance.autoAbsentCutoffTime'))}
        </div>
      </SettingsSection>
    </Form>
  );
}
