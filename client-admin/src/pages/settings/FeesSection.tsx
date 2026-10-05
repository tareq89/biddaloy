/**
 * [16.7.6] "Fees" settings section — D8/D9/D11's three school-wide knobs:
 * step-up approval mode (OTP-only or OTP-or-password), notify-families
 * defaults per trigger (D13's "schedules default on, manual batches
 * default off" only reads as a *default* here — this section just sets
 * that default, per-batch still overrides it), and late-fee config per
 * `FeeType`. Same partial-save shape every other section on this page
 * uses (`AttendanceSection.tsx`'s own comment explains it): its own
 * `SettingsSection` PATCHes `{ version: 1, fees: {...} }` only.
 *
 * Late-fee `grace_days`/`kind`/`value` are keyed by `FeeType` — `LATE_FEE`
 * itself is excluded from the row list since it's the line late fees
 * *produce* (D11), not a fee type they can apply to.
 */
import { FeeType } from '@biddaloy/shared';
import {
  Checkbox,
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
} from '@biddaloy/ui/components';
import {
  useUpdateSchoolSettings,
  type FeesSettings,
  type LateFeeSetting,
} from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { useFormShellMode, useWarnUnsavedChanges } from '@biddaloy/ui/shells';
import { zodResolver } from '@hookform/resolvers/zod';
import type * as React from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { latinBounded } from './latin-digits';
import { SettingsSaved, SettingsSection } from './settings-layout';
import { SettingsMutationError } from './settings-mutation-error';
import { useIsPhone } from './use-is-phone';

const LATE_FEE_TYPES = Object.values(FeeType).filter((type) => type !== FeeType.LATE_FEE);

const lateFeeSchema = z
  .object({
    enabled: z.boolean(),
    graceDays: latinBounded(0, 60),
    kind: z.enum(['PERCENT', 'FLAT']),
    // No server-side cap exists on a FLAT late fee (same as fee-structure
    // `amount`, itself unbounded) — `boundedNumericString` requires a max,
    // so use an effectively-unbounded sentinel here rather than inventing
    // a client-only ceiling the server would happily accept past. The
    // real, meaningful bound (0-100) is PERCENT-only, enforced below.
    value: latinBounded(0, Number.MAX_SAFE_INTEGER),
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
  // Second binding so the fee-name namespace is loaded (and awaited) even where the route loader did not.
  const { t: tFeeTypes } = useTranslation('feeStructures');
  const isPhone = useIsPhone();
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

  const feeName = (type: string) => tFeeTypes(`feeTypes.${type}`, { ns: 'feeStructures' });

  const checkboxField = (
    name: 'notifyOnScheduleDefault' | 'notifyOnManualGenerationDefault',
    label: string,
  ) => (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem className="flex min-h-11 flex-row items-center gap-3 md:min-h-8">
          <FormControl>
            <Checkbox
              id={`fees-${name}`}
              checked={field.value}
              onCheckedChange={(checked) => field.onChange(checked === true)}
            />
          </FormControl>
          <FormLabel htmlFor={`fees-${name}`} className="flex-1 self-stretch">
            {label}
          </FormLabel>
        </FormItem>
      )}
    />
  );

  /** The three inputs of one late-fee row, each labelled for its fee. `visibleLabels` = phone layout. */
  function lateFeeFields(type: string, visibleLabels: boolean) {
    const srOnly = (text: string) => (visibleLabels ? undefined : `${feeName(type)}: ${text}`);
    const kindField = (
      <FormField
        control={form.control}
        name={`lateFees.${type}.kind`}
        render={({ field }) => (
          <FormItem className={visibleLabels ? 'col-span-2' : undefined}>
            {visibleLabels && (
              <FormLabel htmlFor={`fees-lateFee-${type}-kind`}>{t('fees.lateFeeKind')}</FormLabel>
            )}
            <Select value={field.value} onValueChange={field.onChange}>
              <FormControl>
                <SelectTrigger
                  id={`fees-lateFee-${type}-kind`}
                  aria-label={srOnly(t('fees.lateFeeKind'))}
                >
                  <SelectValue />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                <SelectItem value="PERCENT">{t('fees.lateFeeKindPercent')}</SelectItem>
                <SelectItem value="FLAT">{t('fees.lateFeeKindFlat')}</SelectItem>
              </SelectContent>
            </Select>
          </FormItem>
        )}
      />
    );
    const graceField = (
      <FormField
        control={form.control}
        name={`lateFees.${type}.graceDays`}
        render={({ field }) => (
          <FormItem>
            {visibleLabels && (
              <FormLabel htmlFor={`fees-lateFee-${type}-graceDays`}>
                {t('fees.lateFeeGraceDays')}
              </FormLabel>
            )}
            <FormControl>
              <Input
                id={`fees-lateFee-${type}-graceDays`}
                inputMode="numeric"
                aria-label={srOnly(t('fees.lateFeeGraceDays'))}
                {...field}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    );
    const valueField = (
      <FormField
        control={form.control}
        name={`lateFees.${type}.value`}
        render={({ field }) => (
          <FormItem>
            {visibleLabels && (
              <FormLabel htmlFor={`fees-lateFee-${type}-value`}>{t('fees.lateFeeValue')}</FormLabel>
            )}
            <FormControl>
              <Input
                id={`fees-lateFee-${type}-value`}
                inputMode="decimal"
                aria-label={srOnly(t('fees.lateFeeValue'))}
                {...field}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    );
    return { kindField, graceField, valueField };
  }

  const feeCheckbox = (type: string) => (
    <FormField
      control={form.control}
      name={`lateFees.${type}.enabled`}
      render={({ field }) => (
        <FormItem className="flex min-h-11 flex-row items-center gap-3 md:min-h-8">
          <FormControl>
            <Checkbox
              id={`fees-lateFee-${type}-enabled`}
              checked={field.value}
              onCheckedChange={(checked) => field.onChange(checked === true)}
            />
          </FormControl>
          <FormLabel htmlFor={`fees-lateFee-${type}-enabled`} className="flex-1 self-stretch">
            {feeName(type)}
          </FormLabel>
        </FormItem>
      )}
    />
  );

  // A row's inputs show when it is ticked, or when it still carries an error
  // (ticked, mistyped, then unticked) so a blocked save is never invisible.
  const showControls = (type: string) =>
    form.watch(`lateFees.${type}.enabled`) || form.formState.errors.lateFees?.[type] !== undefined;

  return (
    <Form {...form}>
      <SettingsSection
        id="fees-section"
        title={t('fees.title')}
        description={t('fees.description')}
        onSubmit={(event) => void form.handleSubmit(handleSave)(event)}
        saving={updateSettings.isPending}
        footerStart={
          <>
            {updateSettings.isSuccess && <SettingsSaved />}
            {updateSettings.isError && <SettingsMutationError error={updateSettings.error} />}
          </>
        }
      >
        <h3 className="mt-4 text-h3">{t('fees.approvalLegend')}</h3>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <FormField
            control={form.control}
            name="approvalMode"
            render={({ field }) => (
              <FormItem>
                <FormLabel htmlFor="fees-approvalMode">{t('fees.approvalModeLabel')}</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger id="fees-approvalMode">
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="OTP">{t('fees.approvalModeOtp')}</SelectItem>
                    <SelectItem value="OTP_OR_PASSWORD">
                      {t('fees.approvalModeOtpOrPassword')}
                    </SelectItem>
                  </SelectContent>
                </Select>
                <FormDescription>{t('fees.approvalModeHelp')}</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <h3 className="mt-6 border-t border-border-subtle pt-4 text-h3">
          {t('fees.notifyLegend')}
        </h3>
        <div className="mt-2 flex flex-col">
          {checkboxField('notifyOnScheduleDefault', t('fees.notifyOnScheduleDefault'))}
          {checkboxField(
            'notifyOnManualGenerationDefault',
            t('fees.notifyOnManualGenerationDefault'),
          )}
        </div>

        <h3 className="mt-6 border-t border-border-subtle pt-4 text-h3">
          {t('fees.lateFeeLegend')}
        </h3>
        <p className="mt-1 text-text-secondary">
          {t('fees.lateFeeIntro')} {t('fees.lateFeeAppliesFromTomorrow')}
        </p>
        {isPhone ? (
          <ul className="mt-2 divide-y divide-border-subtle">
            {LATE_FEE_TYPES.map((type) => (
              <li key={type} className="flex flex-col">
                {feeCheckbox(type)}
                {showControls(type) && <PhoneLateFee fields={lateFeeFields(type, true)} />}
              </li>
            ))}
          </ul>
        ) : (
          <div className="mt-3 overflow-hidden rounded-lg border border-border-subtle">
            <table className="w-full text-start">
              <thead className="border-b border-border-subtle bg-muted text-label text-text-secondary">
                <tr>
                  <th className="h-10 px-4 text-start font-medium">{t('fees.lateFeeType')}</th>
                  <th className="h-10 w-32 px-4 text-start font-medium">
                    {t('fees.lateFeeGraceDays')}
                  </th>
                  <th className="h-10 w-56 px-4 text-start font-medium">{t('fees.lateFeeKind')}</th>
                  <th className="h-10 w-36 px-4 text-start font-medium">
                    {t('fees.lateFeeValue')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {LATE_FEE_TYPES.map((type) => (
                  <tr key={type}>
                    <td className="px-4 py-1.5">{feeCheckbox(type)}</td>
                    {showControls(type) ? (
                      <DesktopLateFee fields={lateFeeFields(type, false)} />
                    ) : (
                      <>
                        <td className="px-4 text-text-secondary">—</td>
                        <td className="px-4 text-text-secondary">—</td>
                        <td className="px-4 text-text-secondary">—</td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SettingsSection>
    </Form>
  );
}

type LateFeeFields = {
  kindField: React.ReactNode;
  graceField: React.ReactNode;
  valueField: React.ReactNode;
};

function DesktopLateFee({ fields }: { fields: LateFeeFields }) {
  return (
    <>
      <td className="px-4 py-1.5">{fields.graceField}</td>
      <td className="px-4 py-1.5">{fields.kindField}</td>
      <td className="px-4 py-1.5">{fields.valueField}</td>
    </>
  );
}

function PhoneLateFee({ fields }: { fields: LateFeeFields }) {
  return (
    <div className="grid grid-cols-2 gap-3 pb-3">
      {fields.kindField}
      {fields.graceField}
      {fields.valueField}
    </div>
  );
}
