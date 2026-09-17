/**
 * [16.7.6] "Fees" settings section — D8/D9/D11's three school-wide knobs:
 * step-up approval mode (OTP-only or OTP-or-password), notify-families
 * defaults per trigger (D13's "schedules default on, manual batches
 * default off" only reads as a *default* here — this section just sets
 * that default, per-batch still overrides it), and late-fee config per
 * `FeeType`. Same partial-save shape every other section on this page
 * uses (`AttendanceSection.tsx`'s own comment explains it): its own
 * `FormShell` PATCHes `{ version: 1, fees: {...} }` only.
 *
 * Late-fee `grace_days`/`kind`/`value` are keyed by `FeeType` — `LATE_FEE`
 * itself is excluded from the row list since it's the line late fees
 * *produce* (D11), not a fee type they can apply to.
 */
import { FeeType } from '@biddaloy/shared';
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
} from '@biddaloy/ui/components';
import {
  useUpdateSchoolSettings,
  type FeesSettings,
  type LateFeeSetting,
} from '@biddaloy/ui/hooks';
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
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { MutationErrorMessage } from '../../components/MutationErrorMessage';

const LATE_FEE_TYPES = Object.values(FeeType).filter((type) => type !== FeeType.LATE_FEE);

const lateFeeSchema = z
  .object({
    enabled: z.boolean(),
    graceDays: boundedNumericString(0, 60),
    kind: z.enum(['PERCENT', 'FLAT']),
    value: boundedNumericString(0, 100_000_000),
  })
  .refine((row) => row.kind !== 'PERCENT' || Number(row.value) <= 100, {
    message: 'Percent late fees must be between 0 and 100.',
    path: ['value'],
  });

const feesSchema = z.object({
  approvalMode: z.enum(['OTP', 'OTP_OR_PASSWORD']),
  notifyOnManualGenerationDefault: z.boolean(),
  notifyOnScheduleDefault: z.boolean(),
  lateFees: z.record(z.string(), lateFeeSchema),
});

type FeesFormValues = z.infer<typeof feesSchema>;

interface FeesSectionProps {
  schoolId: string;
  fees: FeesSettings | undefined;
}

function defaultLateFee(): FeesFormValues['lateFees'][string] {
  return { enabled: false, graceDays: '0', kind: 'PERCENT', value: '0' };
}

function toFormValues(fees: FeesSettings | undefined): FeesFormValues {
  return {
    approvalMode: fees?.approvalMode ?? 'OTP',
    notifyOnManualGenerationDefault: fees?.notifyOnManualGenerationDefault ?? false,
    notifyOnScheduleDefault: fees?.notifyOnScheduleDefault ?? true,
    lateFees: Object.fromEntries(
      LATE_FEE_TYPES.map((type) => {
        const setting = fees?.late_fees?.[type];
        return [
          type,
          setting
            ? {
                enabled: setting.enabled,
                graceDays: String(setting.grace_days),
                kind: setting.kind,
                value: String(setting.value),
              }
            : defaultLateFee(),
        ];
      }),
    ),
  };
}

export function FeesSection({ schoolId, fees }: FeesSectionProps) {
  const { t } = useTranslation('settings');
  const form = useForm<FeesFormValues>({
    resolver: zodResolver(feesSchema),
    defaultValues: toFormValues(fees),
    ...useFormShellMode(),
  });
  useWarnUnsavedChanges(form.formState.isDirty);

  const updateSettings = useUpdateSchoolSettings(schoolId);

  function handleSave(values: FeesFormValues) {
    const lateFees: Record<string, LateFeeSetting> = {};
    for (const type of LATE_FEE_TYPES) {
      const row = values.lateFees[type];
      if (!row) continue;
      lateFees[type] = {
        enabled: row.enabled,
        grace_days: Number(row.graceDays),
        kind: row.kind,
        value: Number(row.value),
      };
    }
    updateSettings.mutate(
      {
        version: 1,
        fees: {
          approvalMode: values.approvalMode,
          notifyOnManualGenerationDefault: values.notifyOnManualGenerationDefault,
          notifyOnScheduleDefault: values.notifyOnScheduleDefault,
          late_fees: lateFees,
        },
      },
      { onSuccess: () => form.reset(values, { keepIsSubmitSuccessful: true }) },
    );
  }

  const summaryErrors = buildFormShellErrors(
    form.formState.errors,
    (field) => `fees-${field.replace(/\./g, '-')}`,
  );

  return (
    <Form {...form}>
      <FormShell
        errors={summaryErrors}
        submitCount={form.formState.submitCount}
        onSubmit={(event) => void form.handleSubmit(handleSave)(event)}
      >
        <FormSection legend={t('fees.approvalLegend')}>
          <FormField
            control={form.control}
            name="approvalMode"
            render={({ field }) => (
              <FormItem>
                <FormLabel htmlFor="fees-approvalMode">{t('fees.approvalModeLabel')}</FormLabel>
                <FormControl>
                  <select
                    id="fees-approvalMode"
                    className="h-8 rounded-md border border-input bg-card px-2.5 text-sm"
                    {...field}
                  >
                    <option value="OTP">{t('fees.approvalModeOtp')}</option>
                    <option value="OTP_OR_PASSWORD">{t('fees.approvalModeOtpOrPassword')}</option>
                  </select>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </FormSection>

        <FormSection legend={t('fees.notifyLegend')}>
          <FormField
            control={form.control}
            name="notifyOnScheduleDefault"
            render={({ field }) => (
              <FormItem className="flex items-center gap-2">
                <FormControl>
                  <Checkbox
                    id="fees-notifyOnScheduleDefault"
                    checked={field.value}
                    onCheckedChange={(checked) => field.onChange(checked === true)}
                  />
                </FormControl>
                <FormLabel htmlFor="fees-notifyOnScheduleDefault">
                  {t('fees.notifyOnScheduleDefault')}
                </FormLabel>
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="notifyOnManualGenerationDefault"
            render={({ field }) => (
              <FormItem className="flex items-center gap-2">
                <FormControl>
                  <Checkbox
                    id="fees-notifyOnManualGenerationDefault"
                    checked={field.value}
                    onCheckedChange={(checked) => field.onChange(checked === true)}
                  />
                </FormControl>
                <FormLabel htmlFor="fees-notifyOnManualGenerationDefault">
                  {t('fees.notifyOnManualGenerationDefault')}
                </FormLabel>
              </FormItem>
            )}
          />
        </FormSection>

        <FormSection legend={t('fees.lateFeeLegend')}>
          <p className="text-sm text-muted-foreground">{t('fees.lateFeeAppliesFromTomorrow')}</p>
          <div className="flex flex-col gap-4">
            {LATE_FEE_TYPES.map((type) => (
              <div key={type} className="grid grid-cols-[1fr_auto_auto_auto] items-end gap-3">
                <FormField
                  control={form.control}
                  name={`lateFees.${type}.enabled`}
                  render={({ field }) => (
                    <FormItem className="flex items-center gap-2">
                      <FormControl>
                        <Checkbox
                          id={`fees-lateFee-${type}-enabled`}
                          checked={field.value}
                          onCheckedChange={(checked) => field.onChange(checked === true)}
                        />
                      </FormControl>
                      <FormLabel htmlFor={`fees-lateFee-${type}-enabled`}>
                        {t(`feeType.${type}`, { ns: 'common', defaultValue: type })}
                      </FormLabel>
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name={`lateFees.${type}.graceDays`}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel htmlFor={`fees-lateFee-${type}-graceDays`}>
                        {t('fees.lateFeeGraceDays')}
                      </FormLabel>
                      <FormControl>
                        <Input
                          id={`fees-lateFee-${type}-graceDays`}
                          type="number"
                          min={0}
                          max={60}
                          className="w-20"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name={`lateFees.${type}.kind`}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel htmlFor={`fees-lateFee-${type}-kind`}>
                        {t('fees.lateFeeKind')}
                      </FormLabel>
                      <FormControl>
                        <select
                          id={`fees-lateFee-${type}-kind`}
                          className="h-8 rounded-md border border-input bg-card px-2.5 text-sm"
                          {...field}
                        >
                          <option value="PERCENT">{t('fees.lateFeeKindPercent')}</option>
                          <option value="FLAT">{t('fees.lateFeeKindFlat')}</option>
                        </select>
                      </FormControl>
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name={`lateFees.${type}.value`}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel htmlFor={`fees-lateFee-${type}-value`}>
                        {t('fees.lateFeeValue')}
                      </FormLabel>
                      <FormControl>
                        <Input
                          id={`fees-lateFee-${type}-value`}
                          type="number"
                          min={0}
                          className="w-24"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            ))}
          </div>
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
