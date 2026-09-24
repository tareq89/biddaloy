/**
 * [21.7.1] "Routine settings" panel — the `TenantSettings.routine` slice
 * (`RoutineSettings`, `@biddaloy/shared`): changeover minutes (D7) and the
 * two optional scheduling caps. Clone of `AttendanceSection.tsx`'s own
 * plumbing/dirty-handling/error-surfacing (own `FormShell`, PATCHes
 * `{ version: 1, routine: {...} }` only — never the whole
 * `TenantSettingsInput`, same "changed section only" rule every other
 * settings section on the page follows).
 *
 * `subjectPeriodsPerWeek` (a `Record<subjectId, number>`) is left out of
 * this form — editing an arbitrary subject-keyed map needs its own
 * subject picker, which is out of this ticket's scope (period-slot editor,
 * not subject targets). It still round-trips untouched: `handleSave`
 * spreads the previously-loaded `routine` object before applying the form
 * fields, so saving this panel never drops it.
 */
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
  useSchoolSettings,
  useUpdateSchoolSettings,
  type RoutineSettingsInput,
} from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import {
  FormSection,
  FormShell,
  buildFormShellErrors,
  useWarnUnsavedChanges,
} from '@biddaloy/ui/shells';
import { boundedNumericString } from '@biddaloy/ui/utils';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { MutationErrorMessage } from '../../../../components/MutationErrorMessage';

// [21.8.1] `RoutineSettingsDto` requires `@IsInt() @Min(1)` for both caps —
// bare `z.string()` let 0/negative/decimal values through client-side, so
// the server rejected the PATCH with a generic 400 instead of an inline
// field error.
const optionalCap = z
  .string()
  .refine((value) => value === '' || (/^\d+$/.test(value) && Number(value) >= 1), {
    message: 'Must be a whole number of at least 1, or empty for no cap',
  });

const routineSettingsSchema = z.object({
  defaultChangeoverMinutes: boundedNumericString(0, 120),
  maxPeriodsPerTeacherPerDay: optionalCap,
  maxConsecutivePeriods: optionalCap,
});

type RoutineSettingsFormValues = z.infer<typeof routineSettingsSchema>;

function toFormValues(routine: RoutineSettingsInput | undefined): RoutineSettingsFormValues {
  return {
    defaultChangeoverMinutes: String(routine?.defaultChangeoverMinutes ?? 5),
    maxPeriodsPerTeacherPerDay:
      routine?.maxPeriodsPerTeacherPerDay != null ? String(routine.maxPeriodsPerTeacherPerDay) : '',
    maxConsecutivePeriods:
      routine?.maxConsecutivePeriods != null ? String(routine.maxConsecutivePeriods) : '',
  };
}

export interface RoutineSettingsPanelProps {
  schoolId: string;
}

export function RoutineSettingsPanel({ schoolId }: RoutineSettingsPanelProps) {
  const { t } = useTranslation('routines');
  const settingsQuery = useSchoolSettings(schoolId);
  const routine = settingsQuery.data?.routine;

  const form = useForm<RoutineSettingsFormValues>({
    resolver: zodResolver(routineSettingsSchema),
    values: toFormValues(routine),
  });
  useWarnUnsavedChanges(form.formState.isDirty);

  const updateSettings = useUpdateSchoolSettings(schoolId);

  function handleSave(values: RoutineSettingsFormValues) {
    updateSettings.mutate(
      {
        version: 1,
        routine: {
          ...routine,
          defaultChangeoverMinutes: Number(values.defaultChangeoverMinutes),
          maxPeriodsPerTeacherPerDay:
            values.maxPeriodsPerTeacherPerDay === ''
              ? null
              : Number(values.maxPeriodsPerTeacherPerDay),
          maxConsecutivePeriods:
            values.maxConsecutivePeriods === '' ? null : Number(values.maxConsecutivePeriods),
        },
      },
      { onSuccess: () => form.reset(values, { keepIsSubmitSuccessful: true }) },
    );
  }

  const summaryErrors = buildFormShellErrors(
    form.formState.errors,
    (field) => `routine-settings-${field.replace(/\./g, '-')}`,
  );

  return (
    <Form {...form}>
      <FormShell
        errors={summaryErrors}
        submitCount={form.formState.submitCount}
        onSubmit={(event) => void form.handleSubmit(handleSave)(event)}
      >
        <FormSection legend={t('settingsPanel.legend')}>
          <FormField
            control={form.control}
            name="defaultChangeoverMinutes"
            render={({ field }) => (
              <FormItem>
                <FormLabel htmlFor="routine-settings-defaultChangeoverMinutes">
                  {t('settingsPanel.defaultChangeoverMinutes')}
                </FormLabel>
                <FormControl>
                  <Input
                    id="routine-settings-defaultChangeoverMinutes"
                    type="number"
                    min={0}
                    max={120}
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="maxPeriodsPerTeacherPerDay"
            render={({ field }) => (
              <FormItem>
                <FormLabel htmlFor="routine-settings-maxPeriodsPerTeacherPerDay">
                  {t('settingsPanel.maxPeriodsPerTeacherPerDay')}
                </FormLabel>
                <FormControl>
                  <Input
                    id="routine-settings-maxPeriodsPerTeacherPerDay"
                    type="number"
                    min={1}
                    placeholder={t('settingsPanel.noCap')}
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="maxConsecutivePeriods"
            render={({ field }) => (
              <FormItem>
                <FormLabel htmlFor="routine-settings-maxConsecutivePeriods">
                  {t('settingsPanel.maxConsecutivePeriods')}
                </FormLabel>
                <FormControl>
                  <Input
                    id="routine-settings-maxConsecutivePeriods"
                    type="number"
                    min={1}
                    placeholder={t('settingsPanel.noCap')}
                    {...field}
                  />
                </FormControl>
                <FormMessage />
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
