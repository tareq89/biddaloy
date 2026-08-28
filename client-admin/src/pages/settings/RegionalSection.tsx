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
import { boundedNumericString } from '@biddaloy/ui/utils';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { MutationErrorMessage } from '../../components/MutationErrorMessage';

const regionalSchema = z.object({
  locale: z.string().min(1),
  numerals: z.enum(['latin', 'bengali']),
  timezone: z.string().min(1),
  currency: z.object({
    code: z.string().min(1),
    symbol: z.string().min(1),
    position: z.enum(['prefix', 'suffix']),
    // Plain validated strings, not `z.coerce.number()` — see
    // `EmailSection.tsx`'s own comment on the RHF-resolver typing
    // conflict that forces this; parsed back to numbers in `handleSave`.
    // Bounded to match the server's own @Min/@Max — decimal places for a
    // currency display, 0-4 covers every real-world case.
    decimals: boundedNumericString(0, 4),
    grouping: z.enum(['lakh-crore', 'thousand']),
  }),
  date: z.object({
    format: z.string().min(1),
    // 0 (Sunday) through 6 (Saturday).
    firstDayOfWeek: boundedNumericString(0, 6),
    calendar: z.string().min(1),
  }),
  phone: z.object({
    country: z.string().min(1),
    pattern: z.string().min(1),
    example: z.string().min(1),
    displayFormat: z.string().min(1),
  }),
  // Represented as comma-separated text here rather than a repeatable
  // list widget — `RegionAddressDto.fields`/`order` are short, fixed-ish
  // lists (street/city/postcode-shaped things), and a comma-separated
  // input keeps this section's markup proportional to how rarely these
  // two fields actually change, at the cost of no per-item add/remove UI.
  address: z.object({
    fields: z.string().min(1),
    order: z.string().min(1),
  }),
  academicYear: z.object({
    // Calendar month, 1-12.
    startMonth: boundedNumericString(1, 12),
  }),
  identifiers: z.object({
    national: z.string().min(1),
    student: z.string().min(1),
  }),
});

type RegionalFormValues = z.infer<typeof regionalSchema>;
type RegionConfig = NonNullable<TenantSettingsInput['region']>;

interface RegionalSectionProps {
  schoolId: string;
  region: MaskedRegionSettings;
}

function splitList(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function RegionalSection({ schoolId, region }: RegionalSectionProps) {
  const { t } = useTranslation('settings');
  const form = useForm<RegionalFormValues>({
    resolver: zodResolver(regionalSchema),
    defaultValues: {
      locale: region.locale,
      numerals: region.numerals,
      timezone: region.timezone,
      currency: { ...region.currency, decimals: String(region.currency.decimals) },
      date: { ...region.date, firstDayOfWeek: String(region.date.firstDayOfWeek) },
      phone: region.phone,
      address: { fields: region.address.fields.join(', '), order: region.address.order.join(', ') },
      academicYear: { startMonth: String(region.academicYear.startMonth) },
      identifiers: region.identifiers,
    },
    ...useFormShellMode(),
  });

  useWarnUnsavedChanges(form.formState.isDirty && !form.formState.isSubmitSuccessful);

  const updateSettings = useUpdateSchoolSettings(schoolId);

  function handleSave(values: RegionalFormValues) {
    const regionConfig: RegionConfig = {
      ...values,
      currency: { ...values.currency, decimals: Number(values.currency.decimals) },
      date: { ...values.date, firstDayOfWeek: Number(values.date.firstDayOfWeek) },
      address: { fields: splitList(values.address.fields), order: splitList(values.address.order) },
      academicYear: { startMonth: Number(values.academicYear.startMonth) },
    };
    updateSettings.mutate(
      { version: 1, region: regionConfig },
      { onSuccess: () => form.reset(values, { keepIsSubmitSuccessful: true }) },
    );
  }

  const summaryErrors = buildFormShellErrors(
    form.formState.errors,
    (field) => `regional-${field.replace(/\./g, '-')}`,
  );

  return (
    <Form {...form}>
      <FormShell
        errors={summaryErrors}
        submitCount={form.formState.submitCount}
        onSubmit={(event) => void form.handleSubmit(handleSave)(event)}
      >
        <FormSection legend={t('regional.legend')}>
          <FormField
            control={form.control}
            name="locale"
            render={({ field }) => (
              <FormItem>
                <FormLabel htmlFor="regional-locale">{t('regional.locale')}</FormLabel>
                <FormControl>
                  <Input id="regional-locale" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="numerals"
            render={({ field }) => (
              <FormItem>
                <FormLabel htmlFor="regional-numerals">{t('regional.numerals')}</FormLabel>
                <FormControl>
                  <select
                    id="regional-numerals"
                    className="h-8 rounded-md border border-input bg-card px-2.5 text-sm"
                    {...field}
                  >
                    <option value="latin">{t('regional.numeralsLatin')}</option>
                    <option value="bengali">{t('regional.numeralsBengali')}</option>
                  </select>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="timezone"
            render={({ field }) => (
              <FormItem>
                <FormLabel htmlFor="regional-timezone">{t('regional.timezone')}</FormLabel>
                <FormControl>
                  <Input id="regional-timezone" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </FormSection>

        <FormSection legend={t('regional.currencyLegend')}>
          <FormField
            control={form.control}
            name="currency.code"
            render={({ field }) => (
              <FormItem>
                <FormLabel htmlFor="regional-currency-code">{t('regional.currencyCode')}</FormLabel>
                <FormControl>
                  <Input id="regional-currency-code" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="currency.symbol"
            render={({ field }) => (
              <FormItem>
                <FormLabel htmlFor="regional-currency-symbol">
                  {t('regional.currencySymbol')}
                </FormLabel>
                <FormControl>
                  <Input id="regional-currency-symbol" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="currency.position"
            render={({ field }) => (
              <FormItem>
                <FormLabel htmlFor="regional-currency-position">
                  {t('regional.currencyPosition')}
                </FormLabel>
                <FormControl>
                  <select
                    id="regional-currency-position"
                    className="h-8 rounded-md border border-input bg-card px-2.5 text-sm"
                    {...field}
                  >
                    <option value="prefix">{t('regional.currencyPositionPrefix')}</option>
                    <option value="suffix">{t('regional.currencyPositionSuffix')}</option>
                  </select>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="currency.decimals"
            render={({ field }) => (
              <FormItem>
                <FormLabel htmlFor="regional-currency-decimals">
                  {t('regional.currencyDecimals')}
                </FormLabel>
                <FormControl>
                  <Input id="regional-currency-decimals" type="number" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="currency.grouping"
            render={({ field }) => (
              <FormItem>
                <FormLabel htmlFor="regional-currency-grouping">
                  {t('regional.currencyGrouping')}
                </FormLabel>
                <FormControl>
                  <select
                    id="regional-currency-grouping"
                    className="h-8 rounded-md border border-input bg-card px-2.5 text-sm"
                    {...field}
                  >
                    <option value="lakh-crore">{t('regional.currencyGroupingLakhCrore')}</option>
                    <option value="thousand">{t('regional.currencyGroupingThousand')}</option>
                  </select>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </FormSection>

        <FormSection legend={t('regional.dateLegend')}>
          <FormField
            control={form.control}
            name="date.format"
            render={({ field }) => (
              <FormItem>
                <FormLabel htmlFor="regional-date-format">{t('regional.dateFormat')}</FormLabel>
                <FormControl>
                  <Input id="regional-date-format" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="date.firstDayOfWeek"
            render={({ field }) => (
              <FormItem>
                <FormLabel htmlFor="regional-date-firstDayOfWeek">
                  {t('regional.dateFirstDayOfWeek')}
                </FormLabel>
                <FormControl>
                  <Input id="regional-date-firstDayOfWeek" type="number" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="date.calendar"
            render={({ field }) => (
              <FormItem>
                <FormLabel htmlFor="regional-date-calendar">{t('regional.dateCalendar')}</FormLabel>
                <FormControl>
                  <Input id="regional-date-calendar" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </FormSection>

        <FormSection legend={t('regional.phoneLegend')}>
          <FormField
            control={form.control}
            name="phone.country"
            render={({ field }) => (
              <FormItem>
                <FormLabel htmlFor="regional-phone-country">{t('regional.phoneCountry')}</FormLabel>
                <FormControl>
                  <Input id="regional-phone-country" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="phone.pattern"
            render={({ field }) => (
              <FormItem>
                <FormLabel htmlFor="regional-phone-pattern">{t('regional.phonePattern')}</FormLabel>
                <FormControl>
                  <Input id="regional-phone-pattern" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="phone.example"
            render={({ field }) => (
              <FormItem>
                <FormLabel htmlFor="regional-phone-example">{t('regional.phoneExample')}</FormLabel>
                <FormControl>
                  <Input id="regional-phone-example" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="phone.displayFormat"
            render={({ field }) => (
              <FormItem>
                <FormLabel htmlFor="regional-phone-displayFormat">
                  {t('regional.phoneDisplayFormat')}
                </FormLabel>
                <FormControl>
                  <Input id="regional-phone-displayFormat" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </FormSection>

        <FormSection legend={t('regional.addressLegend')}>
          <FormField
            control={form.control}
            name="address.fields"
            render={({ field }) => (
              <FormItem>
                <FormLabel htmlFor="regional-address-fields">
                  {t('regional.addressFields')}
                </FormLabel>
                <FormControl>
                  <Input id="regional-address-fields" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="address.order"
            render={({ field }) => (
              <FormItem>
                <FormLabel htmlFor="regional-address-order">{t('regional.addressOrder')}</FormLabel>
                <FormControl>
                  <Input id="regional-address-order" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </FormSection>

        <FormSection legend={t('regional.academicYearLegend')}>
          <FormField
            control={form.control}
            name="academicYear.startMonth"
            render={({ field }) => (
              <FormItem>
                <FormLabel htmlFor="regional-academicYear-startMonth">
                  {t('regional.academicYearStartMonth')}
                </FormLabel>
                <FormControl>
                  <Input id="regional-academicYear-startMonth" type="number" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </FormSection>

        <FormSection legend={t('regional.identifiersLegend')}>
          <FormField
            control={form.control}
            name="identifiers.national"
            render={({ field }) => (
              <FormItem>
                <FormLabel htmlFor="regional-identifiers-national">
                  {t('regional.identifiersNational')}
                </FormLabel>
                <FormControl>
                  <Input id="regional-identifiers-national" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="identifiers.student"
            render={({ field }) => (
              <FormItem>
                <FormLabel htmlFor="regional-identifiers-student">
                  {t('regional.identifiersStudent')}
                </FormLabel>
                <FormControl>
                  <Input id="regional-identifiers-student" {...field} />
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
