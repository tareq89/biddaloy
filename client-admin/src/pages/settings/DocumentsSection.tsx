/**
 * [48.3.C-02] "Documents" settings section: withhold admit cards when fees are
 * due (D9) and the optional serial short code (D24). The server shallow-merges
 * `documents`, so clearing the code sends `serialPrefix: null`.
 */
import { formatSerial, SERIAL_PREFIX_PATTERN } from '@biddaloy/shared';
import {
  Checkbox,
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
} from '@biddaloy/ui/components';
import { useUpdateSchoolSettings, type MaskedTenantSettings } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { useFormShellMode, useWarnUnsavedChanges } from '@biddaloy/ui/shells';
import { useForm } from 'react-hook-form';

import { SettingsSaved, SettingsSection } from './settings-layout';
import { SettingsMutationError } from './settings-mutation-error';

interface FormValues {
  withholdAdmitCardForDues: boolean;
  serialPrefix: string;
}

interface DocumentsSectionProps {
  schoolId: string;
  documents: MaskedTenantSettings['documents'] | undefined;
}

/** The calendar year in Dhaka (the serial year the server stamps). */
const dhakaYear = () =>
  Number(new Date().toLocaleDateString('en-US', { timeZone: 'Asia/Dhaka', year: 'numeric' }));

export function DocumentsSection({ schoolId, documents }: DocumentsSectionProps) {
  const { t } = useTranslation('settings');
  const form = useForm<FormValues>({
    defaultValues: {
      withholdAdmitCardForDues: documents?.withholdAdmitCardForDues ?? false,
      serialPrefix: documents?.serialPrefix ?? '',
    },
    ...useFormShellMode(),
  });
  const prefix = form.watch('serialPrefix');
  useWarnUnsavedChanges(form.formState.isDirty);
  const updateSettings = useUpdateSchoolSettings(schoolId);
  const example = formatSerial({
    prefix: prefix && SERIAL_PREFIX_PATTERN.test(prefix) ? prefix : undefined,
    kind: 'TRANSFER_CERTIFICATE',
    year: dhakaYear(),
    n: 7,
  });

  function handleSave(values: FormValues) {
    updateSettings.mutate(
      {
        version: 1,
        documents: {
          withholdAdmitCardForDues: values.withholdAdmitCardForDues,
          serialPrefix: values.serialPrefix || null,
        },
      },
      { onSuccess: () => form.reset(values, { keepIsSubmitSuccessful: true }) },
    );
  }

  return (
    <Form {...form}>
      <SettingsSection
        id="documents-section"
        title={t('documents.legend')}
        description={t('documents.description')}
        onSubmit={(event) => void form.handleSubmit(handleSave)(event)}
        saving={updateSettings.isPending}
        footerStart={
          <>
            {updateSettings.isSuccess && <SettingsSaved />}
            {updateSettings.isError && <SettingsMutationError error={updateSettings.error} />}
          </>
        }
      >
        <div className="mt-4 flex flex-col gap-4">
          <FormField
            control={form.control}
            name="withholdAdmitCardForDues"
            render={({ field }) => (
              <FormItem className="flex min-h-11 flex-row items-start gap-3 md:min-h-8">
                <FormControl>
                  <Checkbox
                    id="documents-withhold"
                    checked={field.value}
                    aria-describedby="documents-withholdHint"
                    onCheckedChange={(checked) => field.onChange(checked === true)}
                  />
                </FormControl>
                <div className="flex flex-1 flex-col gap-1">
                  <FormLabel htmlFor="documents-withhold">{t('documents.withholdLabel')}</FormLabel>
                  <p id="documents-withholdHint" className="text-caption text-text-secondary">
                    {t('documents.withholdHint')}
                  </p>
                </div>
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="serialPrefix"
            rules={{
              validate: (v) =>
                v === '' || SERIAL_PREFIX_PATTERN.test(v) || t('documents.prefixInvalid'),
            }}
            render={({ field }) => (
              <FormItem>
                <FormLabel htmlFor="documents-serialPrefix">{t('documents.prefixLabel')}</FormLabel>
                <FormControl>
                  <Input
                    id="documents-serialPrefix"
                    inputMode="text"
                    autoCapitalize="characters"
                    autoComplete="off"
                    maxLength={8}
                    {...field}
                    onChange={(e) => field.onChange(e.target.value.toUpperCase())}
                  />
                </FormControl>
                <FormDescription>{t('documents.prefixHint')}</FormDescription>
                <FormMessage />
                <p className="text-caption text-text-secondary">
                  {t('documents.prefixExample', { serial: example })}
                </p>
              </FormItem>
            )}
          />
        </div>
      </SettingsSection>
    </Form>
  );
}
