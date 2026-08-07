import {
  Button,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
} from '@beton-boi/ui/components';
import {
  useTestSchoolConnection,
  useUpdateSchoolSettings,
  type MaskedWhatsAppSettings,
  type TenantSettingsInput,
} from '@beton-boi/ui/hooks';
import { useTranslation } from '@beton-boi/ui/i18n';
import {
  FormSection,
  FormShell,
  useFormShellMode,
  useWarnUnsavedChanges,
  type FormShellError,
} from '@beton-boi/ui/shells';
import { zodResolver } from '@hookform/resolvers/zod';
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { MutationErrorMessage } from '../../components/MutationErrorMessage';
import { SecretField } from '../../components/SecretField';

const whatsAppSchema = z.object({
  phoneNumberId: z.string().min(1),
  apiVersion: z.string(),
});

type WhatsAppFormValues = z.infer<typeof whatsAppSchema>;
type WhatsAppConfig = NonNullable<NonNullable<TenantSettingsInput['communications']>['whatsapp']>;

interface WhatsAppSectionProps {
  schoolId: string;
  whatsapp: MaskedWhatsAppSettings | undefined;
}

/** Every provider section (this, Messenger, Email, SMS) follows the same
 * shape: `react-hook-form` owns the plain fields, `useState` owns the one
 * (or, for SMS, two) secret field(s) — see `SecretField.tsx`'s own
 * comment on why a secret can't be a normal `Controller`-bound field —
 * and both feed into the same PATCH/test-connection payload builder so
 * "Test connection" always tests exactly what "Save" would persist. */
export function WhatsAppSection({ schoolId, whatsapp }: WhatsAppSectionProps) {
  const { t } = useTranslation('settings');
  const form = useForm<WhatsAppFormValues>({
    resolver: zodResolver(whatsAppSchema),
    defaultValues: {
      phoneNumberId: whatsapp?.phoneNumberId ?? '',
      apiVersion: whatsapp?.apiVersion ?? '',
    },
    ...useFormShellMode(),
  });
  const [accessToken, setAccessToken] = React.useState<string | null | undefined>(undefined);

  useWarnUnsavedChanges(
    (form.formState.isDirty || accessToken !== undefined) && !form.formState.isSubmitSuccessful,
  );

  const updateSettings = useUpdateSchoolSettings(schoolId);
  const testConnection = useTestSchoolConnection(schoolId);

  function buildConfig(values: WhatsAppFormValues): WhatsAppConfig {
    return {
      phoneNumberId: values.phoneNumberId,
      ...(values.apiVersion ? { apiVersion: values.apiVersion } : {}),
      ...(accessToken !== undefined ? { accessToken } : {}),
    };
  }

  function handleSave(values: WhatsAppFormValues) {
    updateSettings.mutate(
      { version: 1, communications: { whatsapp: buildConfig(values) } },
      {
        onSuccess: () => {
          setAccessToken(undefined);
          form.reset(values, { keepIsSubmitSuccessful: true });
        },
      },
    );
  }

  function handleTestConnection() {
    testConnection.mutate({ medium: 'WHATSAPP', config: buildConfig(form.getValues()) });
  }

  const summaryErrors: FormShellError[] = Object.entries(form.formState.errors).map(
    ([field, error]) => ({ field, message: String(error?.message ?? '') }),
  );

  return (
    <Form {...form}>
      <FormShell
        errors={summaryErrors}
        submitCount={form.formState.submitCount}
        onSubmit={(event) => void form.handleSubmit(handleSave)(event)}
      >
        <FormSection legend={t('whatsapp.legend')}>
          <FormField
            control={form.control}
            name="phoneNumberId"
            render={({ field }) => (
              <FormItem>
                <FormLabel htmlFor="whatsapp-phoneNumberId">
                  {t('whatsapp.phoneNumberId')}
                </FormLabel>
                <FormControl>
                  <Input id="whatsapp-phoneNumberId" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="apiVersion"
            render={({ field }) => (
              <FormItem>
                <FormLabel htmlFor="whatsapp-apiVersion">{t('whatsapp.apiVersion')}</FormLabel>
                <FormControl>
                  <Input id="whatsapp-apiVersion" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <SecretField
            id="whatsapp-accessToken"
            label={t('whatsapp.accessToken')}
            masked={whatsapp?.accessToken}
            value={accessToken}
            onChange={setAccessToken}
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
        {testConnection.data && (
          <p
            role="status"
            className={
              testConnection.data.success ? 'text-sm text-emerald-700' : 'text-sm text-destructive'
            }
          >
            {testConnection.data.message}
          </p>
        )}
        {updateSettings.isSuccess && <p role="status">{t('save.success')}</p>}
        {updateSettings.isError && <MutationErrorMessage error={updateSettings.error} />}
      </FormShell>
    </Form>
  );
}
