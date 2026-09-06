import { Button, Checkbox, Form, FormField, FormItem, Label } from '@biddaloy/ui/components';
import { useUpdateSchoolSettings, type AuthSettings } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import {
  FormSection,
  FormShell,
  buildFormShellErrors,
  useFormShellMode,
  useWarnUnsavedChanges,
} from '@biddaloy/ui/shells';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { MutationErrorMessage } from '../../components/MutationErrorMessage';

const signInSchema = z.object({
  otpLoginEnabled: z.boolean(),
});

type SignInFormValues = z.infer<typeof signInSchema>;

interface SignInSectionProps {
  schoolId: string;
  auth: AuthSettings | undefined;
}

/** [12.5] The smallest settings section — one boolean toggle, same shape as
 * `MessengerSection.tsx`'s RHF/`FormShell` wiring but with no secret field
 * to manage. `auth.otpLoginEnabled` defaults to `true` server-side
 * (`DEFAULT_AUTH_SETTINGS`), so an unset value here still renders checked. */
export function SignInSection({ schoolId, auth }: SignInSectionProps) {
  const { t } = useTranslation('settings');
  const form = useForm<SignInFormValues>({
    resolver: zodResolver(signInSchema),
    defaultValues: { otpLoginEnabled: auth?.otpLoginEnabled ?? true },
    ...useFormShellMode(),
  });

  useWarnUnsavedChanges(form.formState.isDirty && !form.formState.isSubmitSuccessful);

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

  const summaryErrors = buildFormShellErrors(form.formState.errors, (field) => `signin-${field}`);

  return (
    <Form {...form}>
      <FormShell
        errors={summaryErrors}
        submitCount={form.formState.submitCount}
        onSubmit={(event) => void form.handleSubmit(handleSave)(event)}
      >
        <FormSection legend={t('signIn.legend')}>
          <FormField
            control={form.control}
            name="otpLoginEnabled"
            render={({ field }) => (
              <FormItem>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="signin-otpLoginEnabled"
                    checked={field.value}
                    onCheckedChange={(checked) => field.onChange(checked === true)}
                  />
                  <Label htmlFor="signin-otpLoginEnabled">{t('signIn.otpLoginEnabled')}</Label>
                </div>
              </FormItem>
            )}
          />
        </FormSection>
        <Button type="submit" loading={updateSettings.isPending}>
          {t('save.action')}
        </Button>
        {updateSettings.isSuccess && <p role="status">{t('save.success')}</p>}
        {updateSettings.isError && <MutationErrorMessage error={updateSettings.error} />}
      </FormShell>
    </Form>
  );
}
