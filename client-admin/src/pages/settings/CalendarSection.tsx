/**
 * [17.3.4] "Calendar" settings section: `termLabel` (what this tenant
 * calls a grading period — TERM/SEMESTER/TRIMESTER) and `country` (drives
 * public-holiday suggestions and date formatting), plus a read-only row
 * showing the derived week start / weekend days.
 *
 * Same partial-save shape as every other section on this page
 * (`RegionalSection.tsx`'s own docstring): PATCHes `{ version: 1, region:
 * {...} }` with the *whole* `region` object, since the server has no
 * narrower PATCH surface for just `country`/`calendar` — every field this
 * section doesn't own is passed through unchanged from `region`, mirroring
 * `RegionalSection.tsx`'s own `country`/`calendar` passthrough (its
 * `[17.1.3]` comment is what defers this UI to here).
 *
 * Week start / weekend days are read from `GET /calendar-settings`
 * (`useCalendarSettings`), not from `region` directly — that endpoint is
 * the one place those are already derived server-side (see
 * `calendar-settings.controller.ts`).
 */
import {
  Button,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@biddaloy/ui/components';
import {
  useCalendarSettings,
  useUpdateSchoolSettings,
  type MaskedRegionSettings,
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
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { MutationErrorMessage } from '../../components/MutationErrorMessage';

/** A short, curated list rather than the full ISO 3166-1 set — every
 * tenant this app has today is either Bangladeshi or a near neighbour;
 * `BD` is the default and first in the list. Extend this list rather than
 * pull in a country-data package for a single settings dropdown. */
const COUNTRIES: Array<{ code: string; en: string; bn: string }> = [
  { code: 'BD', en: 'Bangladesh', bn: 'বাংলাদেশ' },
  { code: 'IN', en: 'India', bn: 'ভারত' },
  { code: 'PK', en: 'Pakistan', bn: 'পাকিস্তান' },
  { code: 'NP', en: 'Nepal', bn: 'নেপাল' },
  { code: 'LK', en: 'Sri Lanka', bn: 'শ্রীলঙ্কা' },
  { code: 'MM', en: 'Myanmar', bn: 'মিয়ানমার' },
  { code: 'US', en: 'United States', bn: 'যুক্তরাষ্ট্র' },
  { code: 'GB', en: 'United Kingdom', bn: 'যুক্তরাজ্য' },
];

const WEEKDAY_KEYS = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
] as const;

const calendarSchema = z.object({
  country: z.string().min(1),
  termLabel: z.enum(['TERM', 'SEMESTER', 'TRIMESTER']),
});

type CalendarFormValues = z.infer<typeof calendarSchema>;

export interface CalendarSectionProps {
  schoolId: string;
  region: MaskedRegionSettings;
}

export function CalendarSection({ schoolId, region }: CalendarSectionProps) {
  const { t, i18n } = useTranslation('settings');
  const calendarSettingsQuery = useCalendarSettings();

  const form = useForm<CalendarFormValues>({
    resolver: zodResolver(calendarSchema),
    defaultValues: {
      country: region.country,
      termLabel: region.calendar?.termLabel ?? 'TERM',
    },
    ...useFormShellMode(),
  });

  useWarnUnsavedChanges(form.formState.isDirty && !form.formState.isSubmitSuccessful);

  const updateSettings = useUpdateSchoolSettings(schoolId);

  function handleSave(values: CalendarFormValues) {
    const regionConfig: NonNullable<TenantSettingsInput['region']> = {
      ...region,
      country: values.country,
      calendar: { termLabel: values.termLabel },
    };
    updateSettings.mutate(
      { version: 1, region: regionConfig },
      { onSuccess: () => form.reset(values, { keepIsSubmitSuccessful: true }) },
    );
  }

  const summaryErrors = buildFormShellErrors(
    form.formState.errors,
    (field) => `calendar-${field.replace(/\./g, '-')}`,
  );

  const weekendLabel = calendarSettingsQuery.data
    ? calendarSettingsQuery.data.weeklyOffDays
        .map((day) => t(`calendar.weekday.${WEEKDAY_KEYS[day]}`))
        .join(t('calendar.weekendSeparator'))
    : undefined;
  const weekStartLabel = calendarSettingsQuery.data
    ? t(`calendar.weekday.${WEEKDAY_KEYS[calendarSettingsQuery.data.firstDayOfWeek]}`)
    : undefined;

  return (
    <Form {...form}>
      <FormShell
        errors={summaryErrors}
        submitCount={form.formState.submitCount}
        onSubmit={(event) => void form.handleSubmit(handleSave)(event)}
      >
        <FormSection legend={t('calendar.legend')}>
          <FormField
            control={form.control}
            name="termLabel"
            render={({ field }) => (
              <FormItem>
                <FormLabel htmlFor="calendar-termLabel">{t('calendar.termLabel')}</FormLabel>
                <FormControl>
                  <select
                    id="calendar-termLabel"
                    className="h-8 rounded-md border border-input bg-card px-2.5 text-sm"
                    {...field}
                  >
                    <option value="TERM">{t('calendar.termLabelTerm')}</option>
                    <option value="SEMESTER">{t('calendar.termLabelSemester')}</option>
                    <option value="TRIMESTER">{t('calendar.termLabelTrimester')}</option>
                  </select>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="country"
            render={({ field }) => (
              <FormItem>
                <FormLabel htmlFor="calendar-country">{t('calendar.country')}</FormLabel>
                <FormControl>
                  <select
                    id="calendar-country"
                    className="h-8 rounded-md border border-input bg-card px-2.5 text-sm"
                    {...field}
                  >
                    {COUNTRIES.map((country) => (
                      <option key={country.code} value={country.code}>
                        {i18n.language === 'bn' ? country.bn : country.en}
                      </option>
                    ))}
                  </select>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">{t('calendar.weekShapeLabel')}</span>
            {calendarSettingsQuery.isPending && (
              <p className="text-sm text-muted-foreground">{t('calendar.weekShapeLoading')}</p>
            )}
            {calendarSettingsQuery.isError && (
              <p role="alert" className="text-sm text-destructive">
                {t('calendar.weekShapeError')}
              </p>
            )}
            {calendarSettingsQuery.data && (
              <p className="text-sm text-muted-foreground">
                {t('calendar.weekShapeValue', {
                  weekStart: weekStartLabel,
                  weekend: weekendLabel,
                  timezone: calendarSettingsQuery.data.timezone,
                })}
              </p>
            )}
            <p className="text-sm text-muted-foreground">
              <a href="#regional-section" className="underline underline-offset-2">
                {t('calendar.changeInRegional')}
              </a>
              {' / '}
              <a href="#attendance-section" className="underline underline-offset-2">
                {t('calendar.changeInAttendance')}
              </a>
            </p>
          </div>
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
