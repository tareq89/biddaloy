import {
  Button,
  Form,
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

import { ConnectionTestResultMessage } from '../../components/ConnectionTestResultMessage';
import { MutationErrorMessage } from '../../components/MutationErrorMessage';
import { SecretField } from '../../components/SecretField';

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
    testConnection.mutate({ medium: 'EMAIL', config: buildConfig(form.getValues()) });
  }

  const summaryErrors = buildFormShellErrors(form.formState.errors, (field) => `email-${field}`);

  return (
    <Form {...form}>
      <FormShell
        errors={summaryErrors}
        submitCount={form.formState.submitCount}
        onSubmit={(event) => void form.handleSubmit(handleSave)(event)}
      >
        <FormSection legend={t('email.legend')}>
          <FormField
            control={form.control}
            name="host"
            render={({ field }) => (
              <FormItem>
                <FormLabel htmlFor="email-host">{t('email.host')}</FormLabel>
                <FormControl>
                  <Input id="email-host" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="port"
            render={({ field }) => (
              <FormItem>
                <FormLabel htmlFor="email-port">{t('email.port')}</FormLabel>
                <FormControl>
                  <Input id="email-port" type="number" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="user"
            render={({ field }) => (
              <FormItem>
                <FormLabel htmlFor="email-user">{t('email.user')}</FormLabel>
                <FormControl>
                  <Input id="email-user" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="from"
            render={({ field }) => (
              <FormItem>
                <FormLabel htmlFor="email-from">{t('email.from')}</FormLabel>
                <FormControl>
                  <Input id="email-from" type="email" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <SecretField
            id="email-password"
            label={t('email.password')}
            masked={email?.password}
            value={password}
            onChange={setPassword}
          />
        </FormSection>
        <div className="flex items-center gap-2">
          <Button type="submit" loading={updateSettings.isPending}>
            {t('save.action')}
          </Button>
          <Button
            type="button"
            variant="outline"
            loading={testConnection.isPending}
            onClick={handleTestConnection}
          >
            {t('testConnection.action')}
          </Button>
        </div>
        <ConnectionTestResultMessage
          data={testConnection.data}
          isError={testConnection.isError}
          error={testConnection.error}
        />
        {updateSettings.isSuccess && <p role="status">{t('save.success')}</p>}
        {updateSettings.isError && <MutationErrorMessage error={updateSettings.error} />}
      </FormShell>
    </Form>
  );
}
