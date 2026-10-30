import { CommunicationStatus } from '@biddaloy/shared';
import { ApiError } from '@biddaloy/ui/api';
import {
  Button,
  ErrorState,
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
  Skeleton,
  StatusBadge,
} from '@biddaloy/ui/components';
import {
  useMessagingProviders,
  useTestSchoolConnection,
  useUpdateSchoolSettings,
  type MaskedMessagingBlock,
  type MaskedSecret,
  type MessagingProviderDescriptor,
  type TenantSettingsInput,
} from '@biddaloy/ui/hooks';
import { useLocale, useTranslation } from '@biddaloy/ui/i18n';
import { useFormShellMode, useWarnUnsavedChanges } from '@biddaloy/ui/shells';
import { boundedNumericString, toLatinDigits } from '@biddaloy/ui/utils';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link } from '@tanstack/react-router';
import { PlugZapIcon, SendIcon } from 'lucide-react';
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { SecretField } from '../../components/SecretField';

import { SettingsSaved, SettingsSection } from './settings-layout';
import { SettingsMutationError } from './settings-mutation-error';

export type MessagingMedium = 'SMS' | 'WHATSAPP' | 'EMAIL' | 'MESSENGER';

const SETTINGS_KEY = {
  SMS: 'sms',
  WHATSAPP: 'whatsapp',
  EMAIL: 'email',
  MESSENGER: 'messenger',
} as const;

type Communications = NonNullable<TenantSettingsInput['communications']>;
type Values = Record<string, string>;
type Secrets = Record<string, string | null | undefined>;

/** Shape checks the descriptor can't express, by field key (kept from the old per-channel forms). */
const FORMAT_OK: Record<string, (v: string) => boolean> = {
  port: (v) => boundedNumericString(1, 65535).safeParse(toLatinDigits(v)).success,
  from: (v) => z.email().safeParse(v).success,
};

/** One form value per (company, field); `__` because RHF would nest a dot. */
const valueKey = (provider: string, field: string) => `${provider}__${field}`;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

/** The saved block of one company: nested (`block[name]`), or the old flat layout for a sole company. */
function savedFields(
  saved: MaskedMessagingBlock | undefined,
  name: string,
  sole: boolean,
): Record<string, unknown> {
  const nested = saved?.[name];
  if (isRecord(nested)) return nested;
  return sole && saved ? saved : {};
}

interface ProviderConfigFormProps {
  medium: MessagingMedium;
  schoolId: string;
  /** The saved (masked) `communications.<medium>` block, from the settings GET. */
  saved: MaskedMessagingBlock | undefined;
  sectionId: string;
  title: string;
  description: string;
  /** Help hint (?) after the title, when the section has an index entry. */
  helpId?: string;
}

/** Settings › Communication card for one medium, drawn from the server's company schema. */
export function ProviderConfigForm(props: ProviderConfigFormProps) {
  const { t } = useTranslation('settings');
  const query = useMessagingProviders(props.schoolId);
  const entry = query.data?.[props.medium];
  if (query.isError || query.isPending) {
    return (
      <SettingsSection
        id={props.sectionId}
        title={props.title}
        description={props.description}
        helpId={props.helpId}
      >
        <div className="mt-4">
          {query.isError ? (
            <ErrorState
              message={t('messaging.loadError')}
              onRetry={() => void query.refetch()}
            />
          ) : (
            <div aria-busy="true" className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          )}
        </div>
      </SettingsSection>
    );
  }
  if (!entry || entry.providers.length === 0) return null;
  return (
    <ProviderConfigFormInner
      {...props}
      providers={entry.providers}
      configured={entry.configured}
      selected={entry.selected}
    />
  );
}

function ProviderConfigFormInner({
  medium,
  schoolId,
  saved,
  sectionId,
  title,
  description,
  helpId,
  providers,
  configured,
  selected: savedSelected,
}: ProviderConfigFormProps & {
  providers: MessagingProviderDescriptor[];
  configured: boolean;
  selected: string | null;
}) {
  const { t } = useTranslation('settings');
  const { locale } = useLocale();
  const sole = providers.length === 1;
  const prefix = SETTINGS_KEY[medium];

  const defaults = React.useMemo(() => {
    const out: Values = {};
    for (const d of providers) {
      const own = savedFields(saved, d.name, sole);
      for (const f of d.fields) {
        if (f.kind === 'secret') continue;
        const v = own[f.key];
        out[valueKey(d.name, f.key)] =
          typeof v === 'string' || typeof v === 'number' ? String(v) : '';
      }
    }
    out.provider = savedSelected ?? providers[0]!.name;
    return out;
    // Defaults are read once, when the form mounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const schema = React.useMemo(() => {
    const shape: Record<string, z.ZodString> = { provider: z.string() };
    for (const d of providers) {
      for (const f of d.fields)
        if (f.kind !== 'secret') shape[valueKey(d.name, f.key)] = z.string();
    }
    return z.object(shape).superRefine((values, ctx) => {
      const chosen = providers.find((d) => d.name === values.provider);
      for (const f of chosen?.fields ?? []) {
        const key = valueKey(chosen!.name, f.key);
        const v = (values[key] ?? '').trim();
        if (f.kind === 'secret') continue;
        if (f.required && v === '') {
          ctx.addIssue({ code: 'custom', path: [key], message: t('messaging.required') });
        } else if (v !== '' && FORMAT_OK[f.key] && !FORMAT_OK[f.key]!(v)) {
          ctx.addIssue({ code: 'custom', path: [key], message: t('messaging.invalid') });
        }
      }
    });
  }, [providers, t]);

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: defaults,
    ...useFormShellMode(),
  });
  const [secrets, setSecrets] = React.useState<Secrets>({});
  const [sendTo, setSendTo] = React.useState('');
  const providerName = form.watch('provider') ?? defaults.provider!;
  const current = providers.find((d) => d.name === providerName) ?? providers[0]!;

  useWarnUnsavedChanges(
    (form.formState.isDirty || Object.values(secrets).some((v) => v !== undefined)) &&
      !form.formState.isSubmitSuccessful,
  );

  const updateSettings = useUpdateSchoolSettings(schoolId);
  const testConnection = useTestSchoolConnection(schoolId);
  const sendTest = useTestSchoolConnection(schoolId);

  /** Only the chosen company's block goes out: other companies' saved blocks stay as they are. */
  function buildConfig(values: Values): Communications[keyof Communications] {
    const block: Record<string, unknown> = {};
    for (const f of current.fields) {
      if (f.kind === 'secret') {
        const s = secrets[valueKey(current.name, f.key)];
        if (s !== undefined) block[f.key] = s;
        continue;
      }
      const v = values[valueKey(current.name, f.key)] ?? '';
      if (v === '' && !f.required) continue;
      block[f.key] = f.key === 'port' ? Number(toLatinDigits(v)) : v;
    }
    return { ...(sole ? {} : { provider: current.name }), [current.name]: block };
  }

  function handleSave(values: Values) {
    updateSettings.mutate(
      { version: 1, communications: { [prefix]: buildConfig(values) } },
      {
        onSuccess: () => {
          setSecrets({});
          form.reset(values, { keepIsSubmitSuccessful: true });
        },
      },
    );
  }

  // Routed through handleSubmit: the same checks as Save run before the request goes out.
  function handleTestConnection() {
    void form.handleSubmit((values) => {
      testConnection.mutate({ medium, config: buildConfig(values) as Record<string, unknown> });
    })();
  }

  function handleSendTest() {
    void form.handleSubmit((values) => {
      sendTest.mutate({
        medium,
        config: buildConfig(values) as Record<string, unknown>,
        sendTo: sendTo.trim(),
      });
    })();
  }

  const label = (d: { label: { en: string; bn: string } }) => d.label[locale];
  const help = (field: string) => {
    const text = t(`help.messaging.${current.name}.${field}`, { defaultValue: '' });
    return text === '' ? undefined : text;
  };

  const errors = form.formState.errors;
  const advancedFields = current.fields.filter((f) => f.advanced);
  const plainFields = current.fields.filter((f) => !f.advanced);

  const textField = (f: MessagingProviderDescriptor['fields'][number]) => {
    const name = valueKey(current.name, f.key);
    const id = `${prefix}-${current.name}-${f.key}`;
    const helpText = help(f.key);
    return (
      <FormField
        key={name}
        control={form.control}
        name={name}
        render={({ field }) => (
          <FormItem>
            <FormLabel htmlFor={id} required={f.required}>
              {label(f)}
            </FormLabel>
            <FormControl>
              <Input id={id} className={f.kind === 'url' ? 'font-mono' : undefined} {...field} />
            </FormControl>
            {helpText && <FormDescription>{helpText}</FormDescription>}
            <FormMessage />
          </FormItem>
        )}
      />
    );
  };

  const secretField = (f: MessagingProviderDescriptor['fields'][number]) => {
    const key = valueKey(current.name, f.key);
    const masked = savedFields(saved, current.name, sole)[f.key] as MaskedSecret | undefined;
    return (
      <div key={key} className="md:col-span-2">
        <SecretField
          id={`${prefix}-${current.name}-${f.key}`}
          label={label(f)}
          masked={masked}
          value={secrets[key]}
          onChange={(v) => setSecrets((prev) => ({ ...prev, [key]: v }))}
          {...(help(f.key) ? { description: help(f.key)! } : {})}
        />
      </div>
    );
  };

  const sendResult = sendTest.data;
  const capReached = sendTest.error instanceof ApiError && sendTest.error.statusCode === 429;

  return (
    <Form {...form}>
      <SettingsSection
        id={sectionId}
        title={title}
        description={description}
        helpId={helpId}
        badge={
          <StatusBadge
            tone={configured ? 'success' : 'neutral'}
            label={t(configured ? 'channelStatus.ready' : 'channelStatus.notReady')}
          />
        }
        onSubmit={(event) => void form.handleSubmit(handleSave)(event)}
        saving={updateSettings.isPending}
        advancedOpen={advancedFields.some((f) => errors[valueKey(current.name, f.key)])}
        advanced={
          advancedFields.length > 0 ? (
            <div className="mt-2 grid gap-4 md:grid-cols-2">{advancedFields.map(textField)}</div>
          ) : undefined
        }
        footerStart={
          <>
            <Button
              type="button"
              variant="outline"
              className="w-full md:w-auto"
              loading={testConnection.isPending}
              onClick={handleTestConnection}
            >
              <PlugZapIcon aria-hidden="true" />
              {t('testConnection.action')}
            </Button>
            {testConnection.data && (
              <p role="status">
                <StatusBadge
                  tone={testConnection.data.success ? 'success' : 'danger'}
                  label={t(
                    testConnection.data.success
                      ? 'testConnection.success'
                      : 'testConnection.failure',
                  )}
                />
              </p>
            )}
            {testConnection.isError && <SettingsMutationError error={testConnection.error} />}
            {updateSettings.isSuccess && <SettingsSaved />}
            {updateSettings.isError && <SettingsMutationError error={updateSettings.error} />}
          </>
        }
      >
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {!sole && (
            <FormField
              control={form.control}
              name="provider"
              render={({ field }) => (
                <FormItem className="md:col-span-2">
                  {medium === 'SMS' ? (
                    <FormLabel
                      htmlFor={`${prefix}-provider`}
                      helpId="administration.settings.field.smsProvider"
                    >
                      {t(`${prefix}.provider`)}
                    </FormLabel>
                  ) : (
                    <FormLabel htmlFor={`${prefix}-provider`}>{t(`${prefix}.provider`)}</FormLabel>
                  )}
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger id={`${prefix}-provider`}>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {providers.map((d) => (
                        <SelectItem key={d.name} value={d.name}>
                          {label(d)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}
          {plainFields.filter((f) => f.kind !== 'secret').map(textField)}
          {plainFields.filter((f) => f.kind === 'secret').map(secretField)}
        </div>

        {current.supportsTestMessage && (
          <div className="mt-4 grid gap-2">
            <label htmlFor={`${prefix}-sendTo`} className="text-label text-text-primary">
              {t(medium === 'EMAIL' ? 'sendTestMessage.email' : 'sendTestMessage.phone')}
            </label>
            <div className="flex flex-col gap-2 md:flex-row md:items-center">
              <Input
                id={`${prefix}-sendTo`}
                type={medium === 'EMAIL' ? 'email' : 'tel'}
                inputMode={medium === 'EMAIL' ? 'email' : 'tel'}
                value={sendTo}
                onChange={(e) => setSendTo(e.target.value)}
              />
              <Button
                type="button"
                variant="outline"
                className="w-full md:w-auto"
                loading={sendTest.isPending}
                disabled={sendTo.trim() === ''}
                onClick={handleSendTest}
              >
                <SendIcon aria-hidden="true" />
                {t('sendTestMessage.label')}
              </Button>
            </div>
            {sendResult?.testMessage && (
              <p role="status" className="text-text-secondary">
                {t('sendTestMessage.sent')}{' '}
                <Link
                  to="/communications/message-log"
                  search={{ status: CommunicationStatus.SENT }}
                  className="font-medium text-primary"
                >
                  {t('sendTestMessage.openLog')}
                </Link>
              </p>
            )}
            {sendResult && !sendResult.testMessage && sendResult.success && (
              <p role="status" className="text-text-secondary">
                {t('sendTestMessage.sink')}
              </p>
            )}
            {sendResult && !sendResult.success && (
              <p role="alert" className="text-destructive">
                {t('sendTestMessage.failed')}
              </p>
            )}
            {sendTest.isError &&
              (capReached ? (
                <p role="alert" className="text-destructive">
                  {t('sendTestMessage.capReached')}
                </p>
              ) : (
                <SettingsMutationError error={sendTest.error} />
              ))}
          </div>
        )}
      </SettingsSection>
    </Form>
  );
}
