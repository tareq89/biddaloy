import {
  Form,
  FormDescription,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
} from '@biddaloy/ui/components';
import {
  useTestSchoolConnection,
  useUpdateSchoolSettings,
  type MaskedEmailSettings,
  type TenantSettingsInput,
} from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { useFormShellMode, useWarnUnsavedChanges } from '@biddaloy/ui/shells';
import { boundedNumericString } from '@biddaloy/ui/utils';
import { zodResolver } from '@hookform/resolvers/zod';
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { SecretField } from '../../components/SecretField';

import { ChannelFooter, ChannelStatusBadge } from './connection-test-status';
import { SettingsSection } from './settings-layout';

const emailSchema = z.object({
  host: z.string().min(1),
  // A plain validated string, not `z.coerce.number()` — RHF's Resolver
  // type distinguishes the form's pre-submit "input" shape from the
  // resolver's post-validation "output" shape, and a coerced field needs
  // `useForm`'s three type parameters wired to match; simpler to keep the
  // field a string end to end and parse it once in `buildConfig` below.
  port: boundedNumericString(1, 65535),
  user: z.string().min(1),
  from: z.email(),
});

type EmailFormValues = z.infer<typeof emailSchema>;
type EmailConfig = NonNullable<NonNullable<TenantSettingsInput['communications']>['email']>;

interface EmailSectionProps {
  schoolId: string;
  email: MaskedEmailSettings | undefined;
}

/** Same shape as `WhatsAppSection.tsx` — see that file's own comment for
 * the RHF-plain-fields / useState-secret split every provider section
 * follows. */
export function EmailSection({ schoolId, email }: EmailSectionProps) {
  const { t } = useTranslation('settings');
  const form = useForm<EmailFormValues>({
    resolver: zodResolver(emailSchema),
    defaultValues: {
      host: email?.host ?? '',
      port: String(email?.port ?? 587),
      user: email?.user ?? '',
      from: email?.from ?? '',
    },
    ...useFormShellMode(),
  });
  const [password, setPassword] = React.useState<string | null | undefined>(undefined);

  useWarnUnsavedChanges(
    (form.formState.isDirty || password !== undefined) && !form.formState.isSubmitSuccessful,
  );

  const updateSettings = useUpdateSchoolSettings(schoolId);
  const testConnection = useTestSchoolConnection(schoolId);

  function buildConfig(values: EmailFormValues): EmailConfig {
    return {
      host: values.host,
      port: Number(values.port),
      user: values.user,
      from: values.from,
      ...(password !== undefined ? { password } : {}),
    };
  }

  function handleSave(values: EmailFormValues) {
    updateSettings.mutate(
      { version: 1, communications: { email: buildConfig(values) } },
      {
        onSuccess: () => {
          setPassword(undefined);
          form.reset(values, { keepIsSubmitSuccessful: true });
        },
      },
    );
  }

  function handleTestConnection() {
    // form.getValues() reads raw, unvalidated input — an out-of-range port
    // or malformed `from` address would otherwise reach the connection-test
    // endpoint unchecked. Routing through handleSubmit runs the same
    // validation the Save button does before the request goes out.
    void form.handleSubmit((values) => {
      testConnection.mutate({ medium: 'EMAIL', config: buildConfig(values) });
    })();
  }

  const ready = Boolean(email?.host && email.password?.configured);

  const field = (
    name: 'from' | 'host' | 'user',
    label: string,
    options: { type?: string; mono?: boolean } = {},
  ) => (
    <FormField
      control={form.control}
      name={name}
      render={({ field: f }) => (
        <FormItem>
          <FormLabel htmlFor={`email-${name}`} required>
            {label}
          </FormLabel>
          <FormControl>
            <Input
              id={`email-${name}`}
              type={options.type}
              className={options.mono ? 'font-mono' : undefined}
              {...f}
            />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );

  return (
    <Form {...form}>
      <SettingsSection
        id="email-section"
        title={t('email.legend')}
        description={t('email.description')}
        badge={<ChannelStatusBadge ready={ready} />}
        onSubmit={(event) => void form.handleSubmit(handleSave)(event)}
        saving={updateSettings.isPending}
        advancedOpen={!!form.formState.errors.port}
        advanced={
          <div className="mt-2 grid gap-4 md:grid-cols-2">
            <FormField
              control={form.control}
              name="port"
              render={({ field: f }) => (
                <FormItem>
                  <FormLabel htmlFor="email-port">{t('email.port')}</FormLabel>
                  <FormControl>
                    <Input id="email-port" inputMode="numeric" {...f} />
                  </FormControl>
                  <FormDescription>{t('email.portHelp')}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        }
        footerStart={
          <ChannelFooter
            onTest={handleTestConnection}
            test={testConnection}
            update={updateSettings}
          />
        }
      >
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {field('from', t('email.from'), { type: 'email' })}
          {field('host', t('email.host'), { mono: true })}
          {field('user', t('email.user'))}
          <SecretField
            id="email-password"
            label={t('email.password')}
            masked={email?.password}
            value={password}
            onChange={setPassword}
          />
        </div>
      </SettingsSection>
    </Form>
  );
}
