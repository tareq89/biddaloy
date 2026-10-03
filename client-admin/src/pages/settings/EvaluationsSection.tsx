/**
 * [28.4.3] "Evaluations" settings section — one school-wide knob:
 * whether a new incident report also sends an SMS (push is always on).
 * Same partial-save shape as `FeesSection.tsx`: PATCHes
 * `{ version: 1, evaluations: {...} }` only. Default off.
 */
import {
  Button,
  Checkbox,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
} from '@biddaloy/ui/components';
import { useUpdateSchoolSettings, type MaskedTenantSettings } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import {
  FormSection,
  FormShell,
  useFormShellMode,
  useWarnUnsavedChanges,
} from '@biddaloy/ui/shells';
import { useForm } from 'react-hook-form';

import { MutationErrorMessage } from '../../components/MutationErrorMessage';

interface FormValues {
  incidentSmsEnabled: boolean;
}

interface EvaluationsSectionProps {
  schoolId: string;
  evaluations: MaskedTenantSettings['evaluations'] | undefined;
  /** Same test the server uses before sending (`communications.sms.provider` is set). */
  smsConfigured?: boolean;
}

export function EvaluationsSection({
  schoolId,
  evaluations,
  smsConfigured = false,
}: EvaluationsSectionProps) {
  const { t } = useTranslation('settings');
  const form = useForm<FormValues>({
    defaultValues: { incidentSmsEnabled: evaluations?.incidentSmsEnabled ?? false },
    ...useFormShellMode(),
  });
  const smsOn = form.watch('incidentSmsEnabled');
  useWarnUnsavedChanges(form.formState.isDirty);
  const updateSettings = useUpdateSchoolSettings(schoolId);

  function handleSave(values: FormValues) {
    updateSettings.mutate(
      { version: 1, evaluations: { incidentSmsEnabled: values.incidentSmsEnabled } },
      { onSuccess: () => form.reset(values, { keepIsSubmitSuccessful: true }) },
    );
  }

  return (
    <Form {...form}>
      <FormShell
        errors={[]}
        submitCount={form.formState.submitCount}
        onSubmit={(event) => void form.handleSubmit(handleSave)(event)}
      >
        <FormSection legend={t('evaluations.legend')}>
          <FormField
            control={form.control}
            name="incidentSmsEnabled"
            render={({ field }) => (
              <FormItem className="flex items-center gap-2">
                <FormControl>
                  <Checkbox
                    id="evaluations-incidentSmsEnabled"
                    checked={field.value}
                    aria-describedby="evaluations-incidentSmsHint"
                    onCheckedChange={(checked) => field.onChange(checked === true)}
                  />
                </FormControl>
                <FormLabel htmlFor="evaluations-incidentSmsEnabled">
                  {t('evaluations.incidentSmsLabel')}
                </FormLabel>
              </FormItem>
            )}
          />
          <p id="evaluations-incidentSmsHint" className="text-sm text-muted-foreground">
            {t('evaluations.incidentSmsHint')}
          </p>
          <p
            role={smsOn && !smsConfigured ? 'alert' : 'status'}
            className={
              smsOn && !smsConfigured ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'
            }
          >
            {smsConfigured
              ? t('evaluations.providerConfigured')
              : smsOn
                ? t('evaluations.providerMissingWarning')
                : t('evaluations.providerNotConfigured')}
          </p>
          <p className="text-sm text-muted-foreground">{t('evaluations.pushAlwaysOn')}</p>
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
