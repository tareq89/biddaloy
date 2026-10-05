import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@biddaloy/ui/components';
import {
  useUpdateSchoolSettings,
  type MaskedRegionSettings,
  type TenantSettingsInput,
} from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { useFormShellMode, useWarnUnsavedChanges } from '@biddaloy/ui/shells';
import {
  boundedNumericString,
  formatCurrency,
  formatMonthName,
  formatNumber,
} from '@biddaloy/ui/utils';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm, type FieldPath } from 'react-hook-form';
import { z } from 'zod';

import { MutationErrorMessage } from '../../components/MutationErrorMessage';

import { COUNTRIES, WEEKDAY_KEYS } from './CalendarSection';
import { SettingsSaved, SettingsSection } from './settings-layout';

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
    // 0 (Sunday) through 6 (Saturday). `date.format` and `date.calendar` are
    // not editable (nothing reads the format since D5; only `gregory` works):
    // `handleSave` sends the stored values back unchanged.
    firstDayOfWeek: boundedNumericString(0, 6),
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
    // The server accepts an empty student-ID rule ("no format enforced").
    student: z.string(),
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

/** Errors under any field inside the "Advanced" disclosure open it. */
const ADVANCED_ERROR_ROOTS = ['timezone', 'phone', 'address', 'identifiers'] as const;

interface Choice {
  value: string;
  label: string;
}

export function RegionalSection({ schoolId, region }: RegionalSectionProps) {
  const { t, i18n } = useTranslation('settings');
  const regionConfig = useRegionConfig();
  const form = useForm<RegionalFormValues>({
    resolver: zodResolver(regionalSchema),
    defaultValues: {
      locale: region.locale,
      numerals: region.numerals,
      timezone: region.timezone,
      currency: { ...region.currency, decimals: String(region.currency.decimals) },
      date: { firstDayOfWeek: String(region.date.firstDayOfWeek) },
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
    const regionConfigToSave: RegionConfig = {
      ...values,
      // [17.1.3] `country` and `calendar` aren't editable in this form
      // (`CalendarSection` owns them): pass the existing values through
      // unchanged so a save here can't drop them.
      country: region.country,
      ...(region.calendar ? { calendar: region.calendar } : {}),
      currency: { ...values.currency, decimals: Number(values.currency.decimals) },
      date: {
        format: region.date.format,
        calendar: region.date.calendar,
        firstDayOfWeek: Number(values.date.firstDayOfWeek),
      },
      address: { fields: splitList(values.address.fields), order: splitList(values.address.order) },
      academicYear: { startMonth: Number(values.academicYear.startMonth) },
    };
    updateSettings.mutate(
      { version: 1, region: regionConfigToSave },
      { onSuccess: () => form.reset(values, { keepIsSubmitSuccessful: true }) },
    );
  }

  const errors = form.formState.errors;
  const hasAdvancedError =
    ADVANCED_ERROR_ROOTS.some((root) => errors[root] !== undefined) ||
    errors.currency?.code !== undefined;

  // Choices that show plain words instead of codes. A stored value outside
  // the known list stays selectable as "keep the current value".
  const withCurrent = (choices: Choice[], current: string): Choice[] =>
    choices.some((c) => c.value === current)
      ? choices
      : [...choices, { value: current, label: t('regional.keepCurrent') }];
  const localeChoices = withCurrent(
    [
      { value: 'bn-BD', label: t('regional.localeBnBd') },
      { value: 'en-BD', label: t('regional.localeEnBd') },
    ],
    region.locale,
  );
  const countryChoices = withCurrent(
    COUNTRIES.map((c) => ({ value: c.code, label: i18n.language === 'bn' ? c.bn : c.en })),
    region.phone.country,
  );
  const numeralChoices: Choice[] = [
    { value: 'latin', label: t('regional.numeralsLatin') },
    { value: 'bengali', label: t('regional.numeralsBengali') },
  ];
  const weekdayChoices: Choice[] = WEEKDAY_KEYS.map((key, i) => ({
    value: String(i),
    label: t(`calendar.weekday.${key}`),
  }));
  const monthChoices: Choice[] = Array.from({ length: 12 }, (_, i) => ({
    value: String(i + 1),
    label: formatMonthName(i + 1, regionConfig),
  }));
  const decimalChoices: Choice[] = Array.from({ length: 5 }, (_, i) => ({
    value: String(i),
    label: formatNumber(i, regionConfig),
  }));

  function selectField(
    name: FieldPath<RegionalFormValues>,
    id: string,
    label: string,
    choices: Choice[],
    options: { help?: string; wide?: boolean } = {},
  ) {
    return (
      <FormField
        control={form.control}
        name={name}
        render={({ field }) => (
          <FormItem className={options.wide ? 'md:col-span-2' : undefined}>
            <FormLabel htmlFor={id}>{label}</FormLabel>
            <Select value={field.value as string} onValueChange={field.onChange}>
              <FormControl>
                <SelectTrigger id={id}>
                  <SelectValue />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                {choices.map((c) => (
                  <SelectItem key={c.value} value={c.value}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {options.help && <FormDescription>{options.help}</FormDescription>}
            <FormMessage />
          </FormItem>
        )}
      />
    );
  }

  function inputField(
    name: FieldPath<RegionalFormValues>,
    id: string,
    label: string,
    options: { help?: string; mono?: boolean; placeholder?: string } = {},
  ) {
    return (
      <FormField
        control={form.control}
        name={name}
        render={({ field }) => (
          <FormItem>
            <FormLabel htmlFor={id}>{label}</FormLabel>
            <FormControl>
              <Input
                id={id}
                className={options.mono ? 'font-mono' : undefined}
                placeholder={options.placeholder}
                {...field}
                value={field.value as string}
              />
            </FormControl>
            {options.help && <FormDescription>{options.help}</FormDescription>}
            <FormMessage />
          </FormItem>
        )}
      />
    );
  }

  // Live example of the money settings, built from what is typed right now.
  const currency = form.watch('currency');
  const decimals = Number(currency.decimals);
  let amount = '—';
  if (Number.isInteger(decimals) && decimals >= 0 && decimals <= 4) {
    try {
      amount = formatCurrency(1234567 * 10 ** decimals, {
        ...regionConfig,
        numerals: form.watch('numerals'),
        currency: { ...currency, decimals },
      });
    } catch {
      amount = '—';
    }
  }

  const advanced = (
    <div className="pt-2">
      <p className="text-caption text-text-secondary">{t('regional.advancedHelp')}</p>
      <div className="mt-3 grid gap-4 md:grid-cols-2">
        {inputField('timezone', 'regional-timezone', t('regional.timezone'), {
          help: t('regional.timezoneHelp'),
          mono: true,
        })}
        {inputField('currency.code', 'regional-currency-code', t('regional.currencyCode'), {
          help: t('regional.currencyCodeHelp'),
          mono: true,
        })}
      </div>
      <h3 className="mt-6 border-t border-border-subtle pt-4 text-h3">
        {t('regional.phoneLegend')}
      </h3>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        {selectField(
          'phone.country',
          'regional-phone-country',
          t('regional.phoneCountry'),
          countryChoices,
        )}
        {inputField('phone.example', 'regional-phone-example', t('regional.phoneExample'))}
        {inputField(
          'phone.displayFormat',
          'regional-phone-displayFormat',
          t('regional.phoneDisplayFormat'),
          { help: t('regional.phoneDisplayFormatHelp'), mono: true },
        )}
        {inputField('phone.pattern', 'regional-phone-pattern', t('regional.phonePattern'), {
          help: t('regional.phonePatternHelp'),
          mono: true,
        })}
      </div>
      <h3 className="mt-6 border-t border-border-subtle pt-4 text-h3">
        {t('regional.identifiersLegend')}
      </h3>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        {inputField('address.fields', 'regional-address-fields', t('regional.addressFields'), {
          help: t('regional.commaHelp'),
          mono: true,
        })}
        {inputField('address.order', 'regional-address-order', t('regional.addressOrder'), {
          help: t('regional.commaHelp'),
          mono: true,
        })}
        {inputField(
          'identifiers.national',
          'regional-identifiers-national',
          t('regional.identifiersNational'),
          { mono: true },
        )}
        {inputField(
          'identifiers.student',
          'regional-identifiers-student',
          t('regional.identifiersStudent'),
          { mono: true, placeholder: t('regional.studentIdPlaceholder') },
        )}
      </div>
    </div>
  );

  return (
    <Form {...form}>
      <SettingsSection
        id="regional-section"
        title={t('regional.legend')}
        description={t('regional.description')}
        onSubmit={(event) => void form.handleSubmit(handleSave)(event)}
        saving={updateSettings.isPending}
        footerStart={
          <>
            {updateSettings.isSuccess && <SettingsSaved />}
            {updateSettings.isError && <MutationErrorMessage error={updateSettings.error} />}
          </>
        }
        advanced={advanced}
        advancedOpen={hasAdvancedError}
      >
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {selectField('locale', 'regional-locale', t('regional.locale'), localeChoices)}
          {selectField('numerals', 'regional-numerals', t('regional.numerals'), numeralChoices)}
          {selectField(
            'date.firstDayOfWeek',
            'regional-date-firstDayOfWeek',
            t('regional.dateFirstDayOfWeek'),
            weekdayChoices,
          )}
          {selectField(
            'academicYear.startMonth',
            'regional-academicYear-startMonth',
            t('regional.academicYearStartMonth'),
            monthChoices,
          )}
        </div>

        <h3 className="mt-6 border-t border-border-subtle pt-4 text-h3">
          {t('regional.currencyLegend')}
        </h3>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {inputField('currency.symbol', 'regional-currency-symbol', t('regional.currencySymbol'))}
          {selectField(
            'currency.position',
            'regional-currency-position',
            t('regional.currencyPosition'),
            [
              { value: 'prefix', label: t('regional.currencyPositionPrefix') },
              { value: 'suffix', label: t('regional.currencyPositionSuffix') },
            ],
          )}
          {selectField(
            'currency.decimals',
            'regional-currency-decimals',
            t('regional.currencyDecimals'),
            decimalChoices,
          )}
          {selectField(
            'currency.grouping',
            'regional-currency-grouping',
            t('regional.currencyGrouping'),
            [
              { value: 'lakh-crore', label: t('regional.currencyGroupingLakhCrore') },
              { value: 'thousand', label: t('regional.currencyGroupingThousand') },
            ],
          )}
          <p className="flex items-center gap-2 rounded-md bg-muted px-3 py-2 md:col-span-2">
            {t('regional.currencyPreview', { amount })}
          </p>
        </div>
      </SettingsSection>
    </Form>
  );
}
