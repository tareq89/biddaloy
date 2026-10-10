/**
 * [67.2.07] "Alerts & reminders" settings section: which alert rules are on,
 * the attention times and thresholds, quiet hours and the guardian SMS
 * fallback. Same partial-save shape as `EvaluationsSection.tsx`: PATCHes
 * `{ version: 1, attention: {...} }` only. Urgent rules (`canDisable: false`)
 * are shown locked and never sent as `enabled: false` (the server rejects it).
 */
import {
  ALERT_RULES,
  AlertCategory,
  type AlertRuleKey,
  type AlertRuleMeta,
} from '@biddaloy/shared';
import {
  AlertSeverityBadge,
  Checkbox,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  Switch,
  TimeInput,
} from '@biddaloy/ui/components';
import { useUpdateSchoolSettings, type MaskedTenantSettings } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { useFormShellMode, useWarnUnsavedChanges } from '@biddaloy/ui/shells';
import { toLatinDigits } from '@biddaloy/ui/utils';
import { zodResolver } from '@hookform/resolvers/zod';
import { LockIcon } from 'lucide-react';
import { useForm, type FieldPath } from 'react-hook-form';
import { z } from 'zod';

import { SettingsSaved, SettingsSection } from './settings-layout';
import { SettingsMutationError } from './settings-mutation-error';

type Attention = NonNullable<MaskedTenantSettings['attention']>;

const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;
const GROUP_ORDER = [
  'ADMIN',
  'EXECUTIVE',
  'ACCOUNTANT',
  'TEACHER',
  'OFFICE_STAFF',
  'EXAM_CONTROLLER',
  'PARENT',
  'STUDENT',
  'COMMITTEE',
  'everyone',
] as const;

/** Ranges mirror the server DTO (67.1.06); the message is shown translated, never this text. */
const bounded = (min: number, max: number) =>
  z
    .string()
    .transform(toLatinDigits)
    .refine((v) => /^\d+$/.test(v) && Number(v) >= min && Number(v) <= max, 'invalid');
const time = z.string().regex(HH_MM);

const schema = z.object({
  rules: z.record(z.string(), z.boolean()),
  attendanceGraceMinutes: bounded(0, 120),
  escalateAttendanceToHeads: z.boolean(),
  classStartingLeadMinutes: bounded(0, 60),
  smsCreditLowThreshold: bounded(0, 100000),
  failedMessagesThreshold: bounded(1, 1000),
  dailyAt: time,
  eveningAt: time,
  quietStart: time,
  quietEnd: time,
  guardianSmsFallback: z.boolean(),
  guardianSmsDailyCap: bounded(0, 10),
});
type Values = z.input<typeof schema>;

/** Rules a school can configure: the platform- and owner-epic rules are not its to touch. */
const SCHOOL_RULES = ALERT_RULES.filter(
  (r) =>
    !r.ownerEpic && r.category !== AlertCategory.PLATFORM && r.category !== AlertCategory.MANUAL,
);

function groupOf(rule: AlertRuleMeta): string {
  return rule.roles.length === 0 || rule.roles.length > 3 ? 'everyone' : rule.roles[0]!;
}

/** Numeric field attached to a rule row. */
const RULE_FIELDS: Partial<
  Record<
    AlertRuleKey,
    { name: FieldPath<Values>; label: string; unit: string; min: number; max: number }
  >
> = {
  'attendance.not_taken': {
    name: 'attendanceGraceMinutes',
    label: 'graceMinutes',
    unit: 'unitMinutes',
    min: 0,
    max: 120,
  },
  'class.starting': {
    name: 'classStartingLeadMinutes',
    label: 'classStartingLead',
    unit: 'unitMinutes',
    min: 0,
    max: 60,
  },
  'comms.sms_credit_low': {
    name: 'smsCreditLowThreshold',
    label: 'smsCreditLow',
    unit: 'unitSms',
    min: 0,
    max: 100000,
  },
  'comms.failed_messages': {
    name: 'failedMessagesThreshold',
    label: 'failedMessages',
    unit: 'unitMessages',
    min: 1,
    max: 1000,
  },
};

function toValues(a: Attention): Values {
  const rules: Record<string, boolean> = {};
  for (const r of SCHOOL_RULES) rules[r.key] = a.rules?.[r.key]?.enabled ?? true;
  return {
    rules,
    attendanceGraceMinutes: String(a.attendanceGraceMinutes),
    escalateAttendanceToHeads: a.escalateAttendanceToHeads,
    classStartingLeadMinutes: String(a.classStartingLeadMinutes),
    smsCreditLowThreshold: String(a.smsCreditLowThreshold),
    failedMessagesThreshold: String(a.failedMessagesThreshold),
    dailyAt: a.dailyAt,
    eveningAt: a.eveningAt,
    quietStart: a.quietHours.start,
    quietEnd: a.quietHours.end,
    guardianSmsFallback: a.guardianSmsFallback,
    guardianSmsDailyCap: String(a.guardianSmsDailyCap),
  };
}

interface AlertsSectionProps {
  schoolId: string;
  attention: Attention;
}

export function AlertsSection({ schoolId, attention }: AlertsSectionProps) {
  const { t } = useTranslation('attention');
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: toValues(attention),
    ...useFormShellMode(),
  });
  const rules = form.watch('rules');
  const fallbackOn = form.watch('guardianSmsFallback');
  useWarnUnsavedChanges(form.formState.isDirty);
  const updateSettings = useUpdateSchoolSettings(schoolId);

  function handleSave(values: Values) {
    const n = (v: string) => Number(toLatinDigits(v));
    updateSettings.mutate(
      {
        version: 1,
        attention: {
          // Only switchable rules; a locked key is never sent.
          rules: Object.fromEntries(
            SCHOOL_RULES.filter((r) => r.canDisable).map((r) => [
              r.key,
              { enabled: values.rules[r.key] ?? true },
            ]),
          ),
          attendanceGraceMinutes: n(values.attendanceGraceMinutes),
          escalateAttendanceToHeads: values.escalateAttendanceToHeads,
          classStartingLeadMinutes: n(values.classStartingLeadMinutes),
          smsCreditLowThreshold: n(values.smsCreditLowThreshold),
          failedMessagesThreshold: n(values.failedMessagesThreshold),
          dailyAt: values.dailyAt,
          eveningAt: values.eveningAt,
          quietHours: { start: values.quietStart, end: values.quietEnd },
          guardianSmsFallback: values.guardianSmsFallback,
          guardianSmsDailyCap: n(values.guardianSmsDailyCap),
        },
      },
      { onSuccess: () => form.reset(form.getValues(), { keepIsSubmitSuccessful: true }) },
    );
  }

  const numberField = (
    name: FieldPath<Values>,
    label: string,
    unit: string,
    min: number,
    max: number,
  ) => (
    <FormField
      control={form.control}
      name={name}
      render={({ field, fieldState }) => (
        <FormItem className="md:w-72">
          <FormLabel htmlFor={`alerts-${name}`}>{label}</FormLabel>
          <div className="flex items-center gap-2">
            <FormControl>
              <Input
                id={`alerts-${name}`}
                // FormMessage is not rendered (the error text is ours), so point at our own line.
                aria-describedby={fieldState.error ? `alerts-${name}-error` : undefined}
                inputMode="numeric"
                {...field}
                value={field.value as string}
              />
            </FormControl>
            <span className="shrink-0 text-text-secondary">{unit}</span>
          </div>
          {fieldState.error ? (
            <p id={`alerts-${name}-error`} role="alert" className="text-caption text-destructive">
              {t('settings.invalidNumber', { min, max })}
            </p>
          ) : null}
        </FormItem>
      )}
    />
  );

  const timeField = (name: 'dailyAt' | 'eveningAt' | 'quietStart' | 'quietEnd', label: string) => (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel htmlFor={`alerts-${name}`}>{label}</FormLabel>
          <TimeInput
            id={`alerts-${name}`}
            aria-label={label}
            value={field.value}
            onValueChange={field.onChange}
          />
          <FormMessage />
        </FormItem>
      )}
    />
  );

  function ruleRow(rule: AlertRuleMeta) {
    const nameId = `alerts-rule-${rule.key}-name`;
    const helpId = `alerts-rule-${rule.key}-help`;
    const field = RULE_FIELDS[rule.key];
    const name = t(`rules.${rule.key}.name`);
    return (
      <li key={rule.key} className="flex flex-col gap-3 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span id={nameId} className="font-medium">
                {name}
              </span>
              <AlertSeverityBadge severity={rule.severity} />
            </div>
            <p id={helpId} className="text-caption text-text-secondary">
              {t(`rules.${rule.key}.help`)}
            </p>
            {!rule.canDisable && (
              <p className="mt-1 inline-flex items-center gap-1 text-caption text-text-secondary md:hidden">
                <LockIcon className="size-3.5" aria-hidden />
                {t('settings.locked')}
              </p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {!rule.canDisable && (
              <span className="hidden items-center gap-1 text-caption text-text-secondary md:inline-flex">
                <LockIcon className="size-3.5" aria-hidden />
                {t('settings.locked')}
              </span>
            )}
            <Switch
              aria-label={name}
              aria-describedby={helpId}
              checked={rule.canDisable ? (rules[rule.key] ?? true) : true}
              disabled={!rule.canDisable}
              className="min-h-11 md:min-h-0"
              onCheckedChange={(checked) =>
                form.setValue('rules', { ...rules, [rule.key]: checked }, { shouldDirty: true })
              }
            />
          </div>
        </div>
        {field &&
          numberField(
            field.name,
            t(`settings.${field.label}`),
            t(`settings.${field.unit}`),
            field.min,
            field.max,
          )}
        {rule.key === 'attendance.not_taken' && (
          <FormField
            control={form.control}
            name="escalateAttendanceToHeads"
            render={({ field: f }) => (
              <FormItem className="flex min-h-11 flex-row items-center gap-3 md:min-h-8">
                <FormControl>
                  <Checkbox
                    id="alerts-escalate"
                    checked={f.value}
                    onCheckedChange={(checked) => f.onChange(checked === true)}
                  />
                </FormControl>
                <FormLabel htmlFor="alerts-escalate" className="flex-1 self-stretch">
                  {t('settings.escalate')}
                </FormLabel>
              </FormItem>
            )}
          />
        )}
      </li>
    );
  }

  const groups = GROUP_ORDER.map((group) => ({
    group,
    rules: SCHOOL_RULES.filter((r) => groupOf(r) === group),
  })).filter((g) => g.rules.length > 0);

  return (
    <Form {...form}>
      <SettingsSection
        id="alerts-section"
        title={t('settings.title')}
        description={t('settings.description')}
        onSubmit={(event) => void form.handleSubmit(handleSave)(event)}
        saving={updateSettings.isPending}
        saveLabel={t('settings.save')}
        footerStart={
          <>
            {updateSettings.isSuccess && <SettingsSaved />}
            {updateSettings.isError && <SettingsMutationError error={updateSettings.error} />}
          </>
        }
      >
        <div className="mt-4 flex flex-col gap-6">
          {groups.map(({ group, rules: groupRules }) => (
            <section key={group} aria-labelledby={`alerts-group-${group}`}>
              <h3 id={`alerts-group-${group}`} className="text-h3">
                {t(`roles.${group}`)}
              </h3>
              <ul className="divide-y divide-border-subtle">{groupRules.map(ruleRow)}</ul>
            </section>
          ))}

          <section aria-labelledby="alerts-times" className="flex flex-col gap-3">
            <h3 id="alerts-times" className="text-h3">
              {t('settings.timesTitle')}
            </h3>
            <div className="grid gap-4 md:grid-cols-2">
              {timeField('dailyAt', t('settings.dailyAt'))}
              {timeField('eveningAt', t('settings.eveningAt'))}
            </div>
          </section>

          <section aria-labelledby="alerts-quiet" className="flex flex-col gap-3">
            <h3 id="alerts-quiet" className="text-h3">
              {t('settings.quietTitle')}
            </h3>
            <p className="text-text-secondary">{t('settings.quietHelp')}</p>
            <div role="group" aria-labelledby="alerts-quiet" className="grid gap-4 md:grid-cols-2">
              {timeField('quietStart', t('settings.quietStart'))}
              {timeField('quietEnd', t('settings.quietEnd'))}
            </div>
          </section>

          <section aria-labelledby="alerts-guardian" className="flex flex-col gap-3">
            <h3 id="alerts-guardian" className="text-h3">
              {t('settings.guardianTitle')}
            </h3>
            <FormField
              control={form.control}
              name="guardianSmsFallback"
              render={({ field }) => (
                <FormItem className="flex flex-row items-start justify-between gap-3">
                  <div className="min-w-0">
                    <FormLabel htmlFor="alerts-smsFallback">{t('settings.smsFallback')}</FormLabel>
                    <p id="alerts-smsFallback-help" className="text-caption text-text-secondary">
                      {t('settings.smsFallbackHelp')}
                    </p>
                  </div>
                  <Switch
                    id="alerts-smsFallback"
                    aria-describedby="alerts-smsFallback-help"
                    checked={field.value}
                    className="min-h-11 shrink-0 md:min-h-0"
                    onCheckedChange={field.onChange}
                  />
                </FormItem>
              )}
            />
            {fallbackOn &&
              numberField(
                'guardianSmsDailyCap',
                t('settings.smsDailyCap'),
                t('settings.unitSms'),
                0,
                10,
              )}
          </section>
        </div>
      </SettingsSection>
    </Form>
  );
}
