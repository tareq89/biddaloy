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
  Card,
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  toast,
} from '@biddaloy/ui/components';
import {
  useSchoolSettings,
  useUpdateSchoolSettings,
  type RoutineSettingsInput,
} from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { useWarnUnsavedChanges } from '@biddaloy/ui/shells';
import { zodResolver } from '@hookform/resolvers/zod';
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

// [21.8.1] `RoutineSettingsDto` requires `@IsInt() @Min(1)` for both caps —
// bare `z.string()` let 0/negative/decimal values through client-side, so
// the server rejected the PATCH with a generic 400 instead of an inline
// field error.
// Messages come from `t()` (built per render), never English literals.
function buildSchema(t: (key: string) => string) {
  const optionalCap = z
    .string()
    .refine((value) => value === '' || (/^\d+$/.test(value) && Number(value) >= 1), {
      message: t('settingsPanel.capInvalid'),
    });
  return z.object({
    defaultChangeoverMinutes: z
      .string()
      .refine((value) => /^\d+$/.test(value) && Number(value) <= 120, {
        message: t('settingsPanel.changeoverInvalid'),
      }),
    maxPeriodsPerTeacherPerDay: optionalCap,
    maxConsecutivePeriods: optionalCap,
  });
}

type RoutineSettingsFormValues = z.infer<ReturnType<typeof buildSchema>>;

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
  const schema = React.useMemo(() => buildSchema((key) => t(key)), [t]);

  const form = useForm<RoutineSettingsFormValues>({
    resolver: zodResolver(schema),
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
      {
        onSuccess: () => {
          form.reset(values, { keepIsSubmitSuccessful: true });
          toast.success(t('save.success'));
        },
        onError: () => toast.error(t('settingsPanel.saveError')),
      },
    );
  }

  return (
    <Card padded={false} className="overflow-hidden">
      <Form {...form}>
        <form onSubmit={(event) => void form.handleSubmit(handleSave)(event)} noValidate>
          <div className="p-4 md:p-5">
            <h2 className="text-h2">{t('settingsPanel.legend')}</h2>
            <p className="mt-1 text-text-secondary">{t('settingsPanel.description')}</p>
          </div>
          <div className="grid gap-4 px-4 pb-4 md:grid-cols-2 md:px-5 md:pb-5">
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
                  <FormDescription>{t('settingsPanel.defaultChangeoverHelp')}</FormDescription>
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
                      inputMode="numeric"
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>{t('settingsPanel.noCapHelp')}</FormDescription>
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
                      inputMode="numeric"
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>{t('settingsPanel.noCapHelp')}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
          <div className="border-t border-border-subtle p-4 md:flex md:justify-end md:px-5">
            <Button type="submit" loading={updateSettings.isPending} className="w-full md:w-auto">
              {t('save.action')}
            </Button>
          </div>
        </form>
      </Form>
    </Card>
  );
}
