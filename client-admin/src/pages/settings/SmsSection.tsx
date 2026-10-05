import {
  Form,
  FormDescription,
  FormControl,
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
  useTestSchoolConnection,
  useUpdateSchoolSettings,
  type MaskedSmsSettings,
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

const smsSchema = z
  .object({
    provider: z.enum(['greenweb', 'mimsms']),
    greenwebApiUrl: z.string(),
    mimsmsSenderId: z.string(),
    mimsmsApiUrl: z.string(),
  })
  // mimsmsSenderId is unconditionally required by the server contract
  // once mimsms is the selected gateway (buildConfig below always sends
  // it), but must stay optional while greenweb is selected — a plain
  // `.min(1)` on the field would incorrectly block saving greenweb-only
  // config that never touched the mimsms fields.
  .superRefine((values, ctx) => {
    if (values.provider === 'mimsms' && values.mimsmsSenderId.trim() === '') {
      ctx.addIssue({
        code: 'custom',
        path: ['mimsmsSenderId'],
        message: 'Required',
      });
    }
  });

type SmsFormValues = z.infer<typeof smsSchema>;
type SmsConfig = NonNullable<NonNullable<TenantSettingsInput['communications']>['sms']>;

interface SmsSectionProps {
  schoolId: string;
  sms: MaskedSmsSettings | undefined;
}

/** The one provider section with a gateway *choice* (`greenweb` vs
 * `mimsms`) — `SmsSettingsDto`'s own shape on the server. Switching the
 * dropdown back and forth doesn't lose whatever was already typed into
 * the other gateway's fields, even though only the *active* gateway's
 * `<FormField>`s are actually rendered (see the conditional below) — the
 * typed values survive because react-hook-form keeps unmounted fields'
 * state by default (`shouldUnregister: false`), and each gateway's
 * secret lives in its own separate `useState` outside the form entirely.
 * Only the active gateway's fields (and its own secret) are included in
 * the payload `buildConfig` sends, matching what the resolver on the
 * server expects for the selected `provider`. */
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

  // Badge from the saved props, never form state: it must not flip while typing.
  const ready =
    sms?.provider === 'mimsms'
      ? Boolean(sms.mimsms?.apiKey?.configured && sms.mimsms.senderId)
      : Boolean(sms?.greenweb?.apiKey?.configured);
  const errors = form.formState.errors;
  const company = provider === 'mimsms' ? t('sms.providerMimsms') : t('sms.providerGreenweb');

  const apiUrlField = (name: 'greenwebApiUrl' | 'mimsmsApiUrl', id: string, label: string) => (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel htmlFor={id}>{label}</FormLabel>
          <FormControl>
            <Input id={id} className="font-mono" {...field} />
          </FormControl>
          <FormDescription>{t('sms.apiUrlHelp')}</FormDescription>
          <FormMessage />
        </FormItem>
      )}
    />
  );

  return (
    <Form {...form}>
      <SettingsSection
        id="sms-section"
        title={t('sms.legend')}
        description={t('sms.description')}
        badge={<ChannelStatusBadge ready={ready} />}
        onSubmit={(event) => void form.handleSubmit(handleSave)(event)}
        saving={updateSettings.isPending}
        advancedOpen={!!(errors.greenwebApiUrl || errors.mimsmsApiUrl)}
        advanced={
          <div className="mt-2 grid gap-4 md:grid-cols-2">
            {provider === 'greenweb'
              ? apiUrlField('greenwebApiUrl', 'sms-greenweb-apiUrl', t('sms.greenwebApiUrl'))
              : apiUrlField('mimsmsApiUrl', 'sms-mimsms-apiUrl', t('sms.mimsmsApiUrl'))}
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
            name="provider"
            render={({ field }) => (
              <FormItem className="md:col-span-2">
                <FormLabel htmlFor="sms-provider">{t('sms.provider')}</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger id="sms-provider">
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="greenweb">{t('sms.providerGreenweb')}</SelectItem>
                    <SelectItem value="mimsms">{t('sms.providerMimsms')}</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          {provider === 'greenweb' ? (
            <div className="md:col-span-2">
              <SecretField
                id="sms-greenweb-apiKey"
                label={t('sms.greenwebApiKey')}
                masked={sms?.greenweb?.apiKey}
                value={greenwebApiKey}
                onChange={setGreenwebApiKey}
                description={t('sms.apiKeyHelp', { company })}
              />
            </div>
          ) : (
            <>
              <FormField
                control={form.control}
                name="mimsmsSenderId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel htmlFor="sms-mimsms-senderId" required>
                      {t('sms.mimsmsSenderId')}
                    </FormLabel>
                    <FormControl>
                      <Input id="sms-mimsms-senderId" {...field} />
                    </FormControl>
                    <FormDescription>{t('sms.senderIdHelp')}</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="md:col-span-2">
                <SecretField
                  id="sms-mimsms-apiKey"
                  label={t('sms.mimsmsApiKey')}
                  masked={sms?.mimsms?.apiKey}
                  value={mimsmsApiKey}
                  onChange={setMimsmsApiKey}
                  description={t('sms.apiKeyHelp', { company })}
                />
              </div>
            </>
          )}
        </div>
      </SettingsSection>
    </Form>
  );
}
