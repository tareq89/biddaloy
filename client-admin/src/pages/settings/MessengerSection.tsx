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
  type MaskedMessengerSettings,
  type TenantSettingsInput,
} from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import {
  FormSection,
  FormShell,
  useFormShellMode,
  useWarnUnsavedChanges,
  type FormShellError,
} from '@biddaloy/ui/shells';
import { zodResolver } from '@hookform/resolvers/zod';
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { MutationErrorMessage } from '../../components/MutationErrorMessage';
import { SecretField } from '../../components/SecretField';

const messengerSchema = z.object({
  pageId: z.string().min(1),
});

type MessengerFormValues = z.infer<typeof messengerSchema>;
type MessengerConfig = NonNullable<NonNullable<TenantSettingsInput['communications']>['messenger']>;

interface MessengerSectionProps {
  schoolId: string;
  messenger: MaskedMessengerSettings | undefined;
}

/** Same shape as `WhatsAppSection.tsx` — see that file's own comment for
 * the RHF-plain-fields / useState-secret split every provider section
 * follows. */
export function MessengerSection({ schoolId, messenger }: MessengerSectionProps) {
  const { t } = useTranslation('settings');
  const form = useForm<MessengerFormValues>({
    resolver: zodResolver(messengerSchema),
    defaultValues: { pageId: messenger?.pageId ?? '' },
    ...useFormShellMode(),
  });
  const [accessToken, setAccessToken] = React.useState<string | null | undefined>(undefined);

  useWarnUnsavedChanges(
    (form.formState.isDirty || accessToken !== undefined) && !form.formState.isSubmitSuccessful,
  );

  const updateSettings = useUpdateSchoolSettings(schoolId);
  const testConnection = useTestSchoolConnection(schoolId);

  function buildConfig(values: MessengerFormValues): MessengerConfig {
    return {
      pageId: values.pageId,
      ...(accessToken !== undefined ? { accessToken } : {}),
    };
  }

  function handleSave(values: MessengerFormValues) {
    updateSettings.mutate(
      { version: 1, communications: { messenger: buildConfig(values) } },
      {
        onSuccess: () => {
          setAccessToken(undefined);
          form.reset(values, { keepIsSubmitSuccessful: true });
        },
      },
    );
  }

  function handleTestConnection() {
    testConnection.mutate({ medium: 'MESSENGER', config: buildConfig(form.getValues()) });
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
        <FormSection legend={t('messenger.legend')}>
          <FormField
            control={form.control}
            name="pageId"
            render={({ field }) => (
              <FormItem>
                <FormLabel htmlFor="messenger-pageId">{t('messenger.pageId')}</FormLabel>
                <FormControl>
                  <Input id="messenger-pageId" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <SecretField
            id="messenger-accessToken"
            label={t('messenger.accessToken')}
            masked={messenger?.accessToken}
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
