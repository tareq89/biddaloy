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
  type MaskedMessengerSettings,
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

  const ready = Boolean(messenger?.pageId && messenger.accessToken?.configured);

  return (
    <Form {...form}>
      <SettingsSection
        id="messenger-section"
        title={t('messenger.legend')}
        description={t('messenger.description')}
        badge={<ChannelStatusBadge ready={ready} />}
        onSubmit={(event) => void form.handleSubmit(handleSave)(event)}
        saving={updateSettings.isPending}
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
            name="pageId"
            render={({ field }) => (
              <FormItem>
                <FormLabel htmlFor="messenger-pageId" required>
                  {t('messenger.pageId')}
                </FormLabel>
                <FormControl>
                  <Input id="messenger-pageId" inputMode="numeric" {...field} />
                </FormControl>
                <FormDescription>{t('messenger.pageIdHelp')}</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <div className="md:col-span-2">
            <SecretField
              id="messenger-accessToken"
              label={t('messenger.accessToken')}
              masked={messenger?.accessToken}
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
