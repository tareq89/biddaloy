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
  type MaskedSmsSettings,
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

const smsSchema = z.object({
  provider: z.enum(['greenweb', 'mimsms']),
  greenwebApiUrl: z.string(),
  mimsmsSenderId: z.string(),
  mimsmsApiUrl: z.string(),
});

type SmsFormValues = z.infer<typeof smsSchema>;
type SmsConfig = NonNullable<NonNullable<TenantSettingsInput['communications']>['sms']>;

interface SmsSectionProps {
  schoolId: string;
  sms: MaskedSmsSettings | undefined;
}

/** The one provider section with a gateway *choice* (`greenweb` vs
 * `mimsms`) — `SmsSettingsDto`'s own shape on the server. Both gateways'
 * fields stay mounted in the DOM (React state, not conditional rendering)
 * so switching the dropdown back and forth doesn't lose whatever was
 * already typed into the other gateway's fields; only the *active*
 * gateway's fields (and its own secret) are included in the payload
 * `buildConfig` sends, matching what the resolver on the server expects
 * for the selected `provider`. */
export function SmsSection({ schoolId, sms }: SmsSectionProps) {
  const { t } = useTranslation('settings');
  const form = useForm<SmsFormValues>({
    resolver: zodResolver(smsSchema),
    defaultValues: {
      provider: sms?.provider ?? 'greenweb',
      greenwebApiUrl: sms?.greenweb?.apiUrl ?? '',
      mimsmsSenderId: sms?.mimsms?.senderId ?? '',
      mimsmsApiUrl: sms?.mimsms?.apiUrl ?? '',
    },
    ...useFormShellMode(),
  });
  const [greenwebApiKey, setGreenwebApiKey] = React.useState<string | null | undefined>(undefined);
  const [mimsmsApiKey, setMimsmsApiKey] = React.useState<string | null | undefined>(undefined);
  const provider = form.watch('provider');

  useWarnUnsavedChanges(
    (form.formState.isDirty || greenwebApiKey !== undefined || mimsmsApiKey !== undefined) &&
      !form.formState.isSubmitSuccessful,
  );

  const updateSettings = useUpdateSchoolSettings(schoolId);
  const testConnection = useTestSchoolConnection(schoolId);

  function buildConfig(values: SmsFormValues): SmsConfig {
    if (values.provider === 'mimsms') {
      return {
        provider: 'mimsms',
        mimsms: {
          senderId: values.mimsmsSenderId,
          ...(values.mimsmsApiUrl ? { apiUrl: values.mimsmsApiUrl } : {}),
          ...(mimsmsApiKey !== undefined ? { apiKey: mimsmsApiKey } : {}),
        },
      };
    }
    return {
      provider: 'greenweb',
      greenweb: {
        ...(values.greenwebApiUrl ? { apiUrl: values.greenwebApiUrl } : {}),
        ...(greenwebApiKey !== undefined ? { apiKey: greenwebApiKey } : {}),
      },
    };
  }

  function handleSave(values: SmsFormValues) {
    updateSettings.mutate(
      { version: 1, communications: { sms: buildConfig(values) } },
      {
        onSuccess: () => {
          setGreenwebApiKey(undefined);
          setMimsmsApiKey(undefined);
          form.reset(values, { keepIsSubmitSuccessful: true });
        },
      },
    );
  }

  function handleTestConnection() {
    testConnection.mutate({ medium: 'SMS', config: buildConfig(form.getValues()) });
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
        <FormSection legend={t('sms.legend')}>
          <FormField
            control={form.control}
            name="provider"
            render={({ field }) => (
              <FormItem>
                <FormLabel htmlFor="sms-provider">{t('sms.provider')}</FormLabel>
                <FormControl>
                  <select
                    id="sms-provider"
                    className="h-8 rounded-md border border-input bg-background px-2.5 text-sm"
                    {...field}
                  >
                    <option value="greenweb">{t('sms.providerGreenweb')}</option>
                    <option value="mimsms">{t('sms.providerMimsms')}</option>
                  </select>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          {provider === 'greenweb' ? (
            <>
              <SecretField
                id="sms-greenweb-apiKey"
                label={t('sms.greenwebApiKey')}
                masked={sms?.greenweb?.apiKey}
                value={greenwebApiKey}
                onChange={setGreenwebApiKey}
              />
              <FormField
                control={form.control}
                name="greenwebApiUrl"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel htmlFor="sms-greenweb-apiUrl">{t('sms.greenwebApiUrl')}</FormLabel>
                    <FormControl>
                      <Input id="sms-greenweb-apiUrl" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </>
          ) : (
            <>
              <SecretField
                id="sms-mimsms-apiKey"
                label={t('sms.mimsmsApiKey')}
                masked={sms?.mimsms?.apiKey}
                value={mimsmsApiKey}
                onChange={setMimsmsApiKey}
              />
              <FormField
                control={form.control}
                name="mimsmsSenderId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel htmlFor="sms-mimsms-senderId">{t('sms.mimsmsSenderId')}</FormLabel>
                    <FormControl>
                      <Input id="sms-mimsms-senderId" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="mimsmsApiUrl"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel htmlFor="sms-mimsms-apiUrl">{t('sms.mimsmsApiUrl')}</FormLabel>
                    <FormControl>
                      <Input id="sms-mimsms-apiUrl" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </>
          )}
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
