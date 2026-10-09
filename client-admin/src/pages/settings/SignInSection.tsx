import { Checkbox, Form, FormField, FormItem, Label } from '@biddaloy/ui/components';
import { useUpdateSchoolSettings, type AuthSettings } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { useFormShellMode, useWarnUnsavedChanges } from '@biddaloy/ui/shells';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { SettingsSaved, SettingsSection } from './settings-layout';
import { SettingsMutationError } from './settings-mutation-error';

const signInSchema = z.object({
  otpLoginEnabled: z.boolean(),
});

type SignInFormValues = z.infer<typeof signInSchema>;

interface SignInSectionProps {
  schoolId: string;
  auth: AuthSettings | undefined;
}

/** [12.5] The smallest settings section — one boolean toggle, same shape as
 * `MessengerSection.tsx`'s RHF wiring, in a `SettingsSection` card, but with no secret field
 * to manage. `auth.otpLoginEnabled` defaults to `true` server-side
 * (`DEFAULT_AUTH_SETTINGS`), so an unset value here still renders checked. */
export function SignInSection({ schoolId, auth }: SignInSectionProps) {
  const { t } = useTranslation('settings');
  const form = useForm<SignInFormValues>({
    resolver: zodResolver(signInSchema),
    defaultValues: { otpLoginEnabled: auth?.otpLoginEnabled ?? true },
    ...useFormShellMode(),
  });

  // `isDirty` alone: `.mutate()` is not awaited, so `isSubmitSuccessful` would silence the
  // warning after a failed save. `onSuccess` resets the form, which clears `isDirty`.
  useWarnUnsavedChanges(form.formState.isDirty);

  const updateSettings = useUpdateSchoolSettings(schoolId);

  function handleSave(values: SignInFormValues) {
    updateSettings.mutate(
      { version: 1, auth: { otpLoginEnabled: values.otpLoginEnabled } },
      {
        onSuccess: () => {
          form.reset(values, { keepIsSubmitSuccessful: true });
        },
      },
    );
  }

  return (
    <Form {...form}>
      <SettingsSection
        id="signin-section"
        title={t('signIn.legend')}
        description={t('signIn.description')}
        onSubmit={(event) => void form.handleSubmit(handleSave)(event)}
        saving={updateSettings.isPending}
        footerStart={
          <>
            {updateSettings.isSuccess && <SettingsSaved />}
            {updateSettings.isError && <SettingsMutationError error={updateSettings.error} />}
          </>
        }
      >
        <FormField
          control={form.control}
          name="otpLoginEnabled"
          render={({ field }) => (
            <FormItem className="mt-4 gap-1">
              <div className="flex min-h-11 items-center gap-3 md:min-h-8">
                <Checkbox
                  id="signin-otpLoginEnabled"
                  checked={field.value}
                  aria-describedby="signin-otpLoginEnabled-help"
                  onCheckedChange={(checked) => field.onChange(checked === true)}
                />
                <Label htmlFor="signin-otpLoginEnabled" className="flex-1 self-stretch">
                  {t('signIn.otpLoginEnabled')}
                </Label>
              </div>
              <p id="signin-otpLoginEnabled-help" className="text-caption text-text-secondary">
                {t('signIn.otpLoginHelp')}
              </p>
            </FormItem>
          )}
        />
      </SettingsSection>
    </Form>
  );
}
