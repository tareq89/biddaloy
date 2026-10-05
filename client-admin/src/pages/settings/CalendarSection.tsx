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
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@biddaloy/ui/components';
import {
  useCalendarSettings,
  useUpdateSchoolSettings,
  type MaskedRegionSettings,
  type TenantSettingsInput,
} from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { useFormShellMode, useWarnUnsavedChanges } from '@biddaloy/ui/shells';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link } from '@tanstack/react-router';
import { ArrowRightIcon, ArrowUpIcon } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { MutationErrorMessage } from '../../components/MutationErrorMessage';

import { SettingsSaved, SettingsSection } from './settings-layout';

/** A short, curated list rather than the full ISO 3166-1 set — every
 * tenant this app has today is either Bangladeshi or a near neighbour;
 * `BD` is the default and first in the list. Extend this list rather than
 * pull in a country-data package for a single settings dropdown. */
export const COUNTRIES: Array<{ code: string; en: string; bn: string }> = [
  { code: 'BD', en: 'Bangladesh', bn: 'বাংলাদেশ' },
  { code: 'IN', en: 'India', bn: 'ভারত' },
  { code: 'PK', en: 'Pakistan', bn: 'পাকিস্তান' },
  { code: 'NP', en: 'Nepal', bn: 'নেপাল' },
  { code: 'LK', en: 'Sri Lanka', bn: 'শ্রীলঙ্কা' },
  { code: 'MM', en: 'Myanmar', bn: 'মিয়ানমার' },
  { code: 'US', en: 'United States', bn: 'যুক্তরাষ্ট্র' },
  { code: 'GB', en: 'United Kingdom', bn: 'যুক্তরাজ্য' },
];

export const WEEKDAY_KEYS = [
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

  const weekendLabel = calendarSettingsQuery.data
    ? calendarSettingsQuery.data.weeklyOffDays
        .map((day) => t(`calendar.weekday.${WEEKDAY_KEYS[day]}`))
        .join(t('calendar.weekendSeparator'))
    : undefined;
  const weekStartLabel = calendarSettingsQuery.data
    ? t(`calendar.weekday.${WEEKDAY_KEYS[calendarSettingsQuery.data.firstDayOfWeek]}`)
    : undefined;

  const linkClass =
    'inline-flex h-11 items-center gap-1 rounded-md px-2 font-medium text-primary hover:bg-surface md:h-8';

  return (
    <Form {...form}>
      <SettingsSection
        id="calendar-section"
        title={t('calendar.legend')}
        description={t('calendar.description')}
        onSubmit={(event) => void form.handleSubmit(handleSave)(event)}
        saving={updateSettings.isPending}
        footerStart={
          <>
            {updateSettings.isSuccess && <SettingsSaved />}
            {updateSettings.isError && <MutationErrorMessage error={updateSettings.error} />}
          </>
        }
      >
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <FormField
            control={form.control}
            name="termLabel"
            render={({ field }) => (
              <FormItem>
                <FormLabel htmlFor="calendar-termLabel">{t('calendar.termLabel')}</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger id="calendar-termLabel">
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="TERM">{t('calendar.termLabelTerm')}</SelectItem>
                    <SelectItem value="SEMESTER">{t('calendar.termLabelSemester')}</SelectItem>
                    <SelectItem value="TRIMESTER">{t('calendar.termLabelTrimester')}</SelectItem>
                  </SelectContent>
                </Select>
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
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger id="calendar-country">
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {COUNTRIES.map((country) => (
                      <SelectItem key={country.code} value={country.code}>
                        {i18n.language === 'bn' ? country.bn : country.en}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormDescription>{t('calendar.countryHelp')}</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <div className="flex flex-col gap-2 rounded-md bg-muted p-3 md:col-span-2">
            <span className="font-medium">{t('calendar.weekShapeLabel')}</span>
            {calendarSettingsQuery.isPending && (
              <p className="text-text-secondary">{t('calendar.weekShapeLoading')}</p>
            )}
            {calendarSettingsQuery.isError && (
              <p role="alert" className="text-destructive">
                {t('calendar.weekShapeError')}
              </p>
            )}
            {calendarSettingsQuery.data && (
              <p className="text-text-secondary">
                {t('calendar.weekShapeValue', {
                  weekStart: weekStartLabel,
                  weekend: weekendLabel,
                })}
              </p>
            )}
            <div className="flex flex-col gap-1 md:flex-row md:gap-2">
              <Link
                to="/settings"
                hash="regional-section"
                search={{ section: 'school' }}
                className={linkClass}
              >
                <ArrowUpIcon aria-hidden="true" className="size-4" />
                {t('calendar.changeInRegional')}
              </Link>
              <Link
                to="/settings"
                hash="attendance-section"
                search={{ section: 'academics' }}
                className={linkClass}
              >
                <ArrowRightIcon aria-hidden="true" className="size-4" />
                {t('calendar.changeInAttendance')}
              </Link>
            </div>
          </div>
        </div>
      </SettingsSection>
    </Form>
  );
}
