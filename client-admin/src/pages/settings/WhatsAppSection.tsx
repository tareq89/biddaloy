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
  type MaskedWhatsAppSettings,
  type TenantSettingsInput,
} from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { useFormShellMode, useWarnUnsavedChanges } from '@biddaloy/ui/shells';
import { zodResolver } from '@hookform/resolvers/zod';
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { SecretField } from '../../components/SecretField';

import { ChannelFooter, ChannelStatusBadge } from './connection-test-status';
import { SettingsSection } from './settings-layout';

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

  // Badge from the saved props, never form state: it must not flip while typing.
  const ready = Boolean(whatsapp?.phoneNumberId && whatsapp.accessToken?.configured);

  return (
    <Form {...form}>
      <SettingsSection
        id="whatsapp-section"
        title={t('whatsapp.legend')}
        description={t('whatsapp.description')}
        badge={<ChannelStatusBadge ready={ready} />}
        onSubmit={(event) => void form.handleSubmit(handleSave)(event)}
        saving={updateSettings.isPending}
        advancedOpen={!!form.formState.errors.apiVersion}
        advanced={
          <div className="mt-2 grid gap-4 md:grid-cols-2">
            <FormField
              control={form.control}
              name="apiVersion"
              render={({ field }) => (
                <FormItem>
                  <FormLabel htmlFor="whatsapp-apiVersion">{t('whatsapp.apiVersion')}</FormLabel>
                  <FormControl>
                    <Input id="whatsapp-apiVersion" className="font-mono" {...field} />
                  </FormControl>
                  <FormDescription>{t('whatsapp.apiVersionHelp')}</FormDescription>
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
          <FormField
            control={form.control}
            name="phoneNumberId"
            render={({ field }) => (
              <FormItem>
                <FormLabel htmlFor="whatsapp-phoneNumberId" required>
                  {t('whatsapp.phoneNumberId')}
                </FormLabel>
                <FormControl>
                  <Input id="whatsapp-phoneNumberId" inputMode="numeric" {...field} />
                </FormControl>
                <FormDescription>{t('whatsapp.phoneNumberIdHelp')}</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <div className="md:col-span-2">
            <SecretField
              id="whatsapp-accessToken"
              label={t('whatsapp.accessToken')}
              masked={whatsapp?.accessToken}
              value={accessToken}
              onChange={setAccessToken}
              description={t('secret.metaTokenHelp')}
            />
          </div>
        </div>
      </SettingsSection>
    </Form>
  );
}
