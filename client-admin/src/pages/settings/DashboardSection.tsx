/**
 * [8.10.7.2.12] "Dashboard" settings section: the four at-risk thresholds (D7),
 * the committee attendance target (D23) and the morning summary time (D31).
 * Same partial-save shape as `EvaluationsSection.tsx`: PATCHes
 * `{ version: 1, dashboard: {...} }` only. Ranges mirror the server's
 * `DashboardSettingsDto`.
 */
import type { DashboardSettings } from '@biddaloy/shared';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  TimeInput,
} from '@biddaloy/ui/components';
import { useUpdateSchoolSettings, type MaskedTenantSettings } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { useFormShellMode, useWarnUnsavedChanges } from '@biddaloy/ui/shells';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { latinBounded } from './latin-digits';
import { SettingsSaved, SettingsSection } from './settings-layout';
import { SettingsMutationError } from './settings-mutation-error';

const DEFAULTS: DashboardSettings = {
  risk: { absentStreakDays: 3, monthlyAttendancePct: 75, failedSubjects: 1, overdueDays: 60 },
  committeeAttendanceTargetPct: 90,
  digestTime: '07:30',
};

const RANGES = {
  absentStreakDays: [1, 30],
  monthlyAttendancePct: [1, 100],
  failedSubjects: [1, 20],
  overdueDays: [1, 365],
  committeeAttendanceTargetPct: [1, 100],
} as const;

const schema = z.object({
  absentStreakDays: latinBounded(...RANGES.absentStreakDays),
  monthlyAttendancePct: latinBounded(...RANGES.monthlyAttendancePct),
  failedSubjects: latinBounded(...RANGES.failedSubjects),
  overdueDays: latinBounded(...RANGES.overdueDays),
  committeeAttendanceTargetPct: latinBounded(...RANGES.committeeAttendanceTargetPct),
  digestTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
});
type Values = z.input<typeof schema>;
type NumberField = keyof typeof RANGES;

interface DashboardSectionProps {
  schoolId: string;
  dashboard: MaskedTenantSettings['dashboard'] | undefined;
}

export function DashboardSection({ schoolId, dashboard }: DashboardSectionProps) {
  const { t } = useTranslation('settings');
  const d = dashboard ?? DEFAULTS;
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      absentStreakDays: String(d.risk.absentStreakDays),
      monthlyAttendancePct: String(d.risk.monthlyAttendancePct),
      failedSubjects: String(d.risk.failedSubjects),
      overdueDays: String(d.risk.overdueDays),
      committeeAttendanceTargetPct: String(d.committeeAttendanceTargetPct),
      digestTime: d.digestTime,
    },
    ...useFormShellMode(),
  });
  useWarnUnsavedChanges(form.formState.isDirty);
  const updateSettings = useUpdateSchoolSettings(schoolId);

  function handleSave(raw: Values) {
    // Already validated by the resolver; parse again to get Latin-digit strings.
    const v = schema.parse(raw);
    const n = (k: NumberField) => Number(v[k]);
    updateSettings.mutate(
      {
        version: 1,
        dashboard: {
          risk: {
            absentStreakDays: n('absentStreakDays'),
            monthlyAttendancePct: n('monthlyAttendancePct'),
            failedSubjects: n('failedSubjects'),
            overdueDays: n('overdueDays'),
          },
          committeeAttendanceTargetPct: n('committeeAttendanceTargetPct'),
          digestTime: v.digestTime,
        },
      },
      // The saved (Latin-digit) values become the form's new defaults.
      { onSuccess: () => form.reset(v, { keepIsSubmitSuccessful: true }) },
    );
  }

  const numberField = (name: NumberField, label: string, hint?: string) => (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel htmlFor={`dashboard-${name}`}>{label}</FormLabel>
          <FormControl>
            <Input id={`dashboard-${name}`} inputMode="numeric" {...field} />
          </FormControl>
          {hint && <FormDescription>{hint}</FormDescription>}
          {form.formState.errors[name] && (
            <p role="alert" className="text-caption text-destructive">
              {t('dashboard.errors.range', { min: RANGES[name][0], max: RANGES[name][1] })}
            </p>
          )}
        </FormItem>
      )}
    />
  );

  return (
    <Form {...form}>
      <SettingsSection
        id="dashboard-section"
        title={t('dashboard.legend')}
        onSubmit={(event) => void form.handleSubmit(handleSave)(event)}
        saving={updateSettings.isPending}
        footerStart={
          <>
            {updateSettings.isSuccess && <SettingsSaved />}
            {updateSettings.isError && <SettingsMutationError error={updateSettings.error} />}
          </>
        }
      >
        <div className="mt-4 flex flex-col gap-6">
          <fieldset className="flex flex-col gap-3">
            <legend className="text-label text-text-primary">{t('dashboard.riskLegend')}</legend>
            <p className="text-caption text-text-secondary">{t('dashboard.riskHint')}</p>
            {numberField('absentStreakDays', t('dashboard.risk.absentStreakDays'))}
            {numberField('monthlyAttendancePct', t('dashboard.risk.monthlyAttendancePct'))}
            {numberField('failedSubjects', t('dashboard.risk.failedSubjects'))}
            {numberField('overdueDays', t('dashboard.risk.overdueDays'))}
            <p className="text-caption text-text-secondary">{t('dashboard.recomputeNote')}</p>
          </fieldset>
          <fieldset className="flex flex-col gap-3">
            <legend className="text-label text-text-primary">
              {t('dashboard.committeeLegend')}
            </legend>
            {numberField(
              'committeeAttendanceTargetPct',
              t('dashboard.committeeAttendanceTargetPct'),
              t('dashboard.committeeAttendanceTargetHint'),
            )}
          </fieldset>
          <fieldset className="flex flex-col gap-3">
            <legend className="text-label text-text-primary">{t('dashboard.digestLegend')}</legend>
            <FormField
              control={form.control}
              name="digestTime"
              render={({ field }) => (
                <FormItem>
                  <FormLabel htmlFor="dashboard-digestTime">{t('dashboard.digestTime')}</FormLabel>
                  <TimeInput
                    id="dashboard-digestTime"
                    aria-label={t('dashboard.digestTime')}
                    value={field.value}
                    onValueChange={field.onChange}
                  />
                  <FormDescription>{t('dashboard.digestHint')}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </fieldset>
        </div>
      </SettingsSection>
    </Form>
  );
}
