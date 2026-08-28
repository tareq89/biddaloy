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
  type MaskedSmsSettings,
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
import { zodResolver } from '@hookform/resolvers/zod';
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { ConnectionTestResultMessage } from '../../components/ConnectionTestResultMessage';
import { MutationErrorMessage } from '../../components/MutationErrorMessage';
import { SecretField } from '../../components/SecretField';

// Every field the `id` doesn't follow directly from `sms-${fieldName}` —
// `provider`/`greenwebApiUrl` do (`sms-provider`, `sms-greenweb-apiUrl`
// after the dash-join, see `SMS_FIELD_IDS` below covers all four instead
// of relying on a naming pattern), but `mimsmsSenderId`/`mimsmsApiUrl`
// map to `sms-mimsms-senderId`/`sms-mimsms-apiUrl`, not
// `sms-mimsmsSenderId` — an explicit map is clearer than a regex that
// has to know both gateways' id conventions.
const SMS_FIELD_IDS: Record<string, string> = {
  provider: 'sms-provider',
  greenwebApiUrl: 'sms-greenweb-apiUrl',
  mimsmsSenderId: 'sms-mimsms-senderId',
  mimsmsApiUrl: 'sms-mimsms-apiUrl',
};

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

  const summaryErrors = buildFormShellErrors(
    form.formState.errors,
    (field) => SMS_FIELD_IDS[field] ?? `sms-${field}`,
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
                    className="h-8 rounded-md border border-input bg-card px-2.5 text-sm"
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
