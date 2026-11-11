/** Step 1 of "Create next year": the new year's name and dates, prefilled from the source year. */
import { DatePicker, Input } from '@biddaloy/ui/components';
import { useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { parseServerDate } from '@biddaloy/ui/utils';

import { Field } from '../-year-form-dialog';

export interface NameStepValues {
  name: string;
  startDate: Date | undefined;
  endDate: Date | undefined;
}

/** "2026-2027" becomes "2027-2028": every 4-digit year in the name goes up by one. No year in
 * the name means we cannot guess, so the field starts empty. */
export function nextYearName(sourceName: string): string {
  if (!/\d{4}/.test(sourceName)) return '';
  return sourceName.replace(/\d{4}/g, (y) => String(Number(y) + 1));
}

/** Starts the day after the source year ends and runs one year (minus a day). */
export function nextYearDates(sourceEnd: string): { startDate: Date; endDate: Date } {
  const end = parseServerDate(sourceEnd);
  const startDate = new Date(end.getFullYear(), end.getMonth(), end.getDate() + 1);
  const endDate = new Date(
    startDate.getFullYear() + 1,
    startDate.getMonth(),
    startDate.getDate() - 1,
  );
  return { startDate, endDate };
}

export function NameStep({
  values,
  onChange,
  error,
}: {
  values: NameStepValues;
  onChange: (next: NameStepValues) => void;
  error: string | null;
}) {
  const { t } = useTranslation('academicYears');
  const regionConfig = useTenantRegionConfig();
  return (
    <div className="flex flex-col gap-4">
      <Field label={t('nextYear.nameLabel')} htmlFor="next-year-name">
        <Input
          id="next-year-name"
          aria-required="true"
          value={values.name}
          onChange={(e) => onChange({ ...values, name: e.target.value })}
        />
        <p className="text-caption text-text-secondary">{t('help.name')}</p>
      </Field>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label={t('nextYear.startLabel')}>
          <DatePicker
            aria-label={t('nextYear.startLabel')}
            config={regionConfig}
            value={values.startDate}
            onValueChange={(startDate) => onChange({ ...values, startDate })}
          />
        </Field>
        <Field label={t('nextYear.endLabel')}>
          <DatePicker
            aria-label={t('nextYear.endLabel')}
            config={regionConfig}
            value={values.endDate}
            onValueChange={(endDate) => onChange({ ...values, endDate })}
          />
        </Field>
      </div>
      <p className="text-caption text-text-secondary">{t('help.dates')}</p>
      {error && (
        <p role="alert" className="text-label text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
