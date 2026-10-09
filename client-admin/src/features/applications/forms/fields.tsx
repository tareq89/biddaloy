/**
 * [52.4.2] The few field wrappers the ten type forms share. Each reads the form
 * through `useFormContext()`, so a `Fields` component is just a list of these.
 */
import {
  DatePicker,
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
  Textarea,
} from '@biddaloy/ui/components';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { parseDate, toIsoDate } from '@biddaloy/ui/utils';
import { useFormContext } from 'react-hook-form';

interface BaseProps {
  name: string;
  label: string;
  /** Short help line under the control. */
  hint?: string | undefined;
  /** Spans both grid columns (long text). */
  wide?: boolean;
  required?: boolean;
}

const span = (wide?: boolean) => (wide ? 'md:col-span-2' : undefined);

export function TextField({
  name,
  label,
  hint,
  wide,
  required = true,
  rows,
  placeholder,
  inputMode,
}: BaseProps & {
  /** Set to render a `Textarea`. */
  rows?: number;
  placeholder?: string;
  inputMode?: 'decimal';
}) {
  const { control } = useFormContext();
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem className={span(wide)}>
          <FormLabel required={required}>{label}</FormLabel>
          <FormControl>
            {rows ? (
              <Textarea rows={rows} placeholder={placeholder} {...field} />
            ) : (
              <Input placeholder={placeholder} inputMode={inputMode} {...field} />
            )}
          </FormControl>
          {hint && <FormDescription>{hint}</FormDescription>}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

/** Picker value is a `YYYY-MM-DD` string; `min` / `max` are `YYYY-MM-DD` too. */
export function DateField({
  name,
  label,
  hint,
  wide,
  required = true,
  min,
  max,
}: BaseProps & { min?: string | undefined; max?: string | undefined }) {
  const { control } = useFormContext();
  const regionConfig = useRegionConfig();
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem className={span(wide)}>
          <FormLabel required={required}>{label}</FormLabel>
          <FormControl>
            <DatePicker
              aria-label={label}
              config={regionConfig}
              value={field.value ? parseDate(field.value as string) : undefined}
              min={min ? parseDate(min) : undefined}
              max={max ? parseDate(max) : undefined}
              onValueChange={(next) => field.onChange(next ? toIsoDate(next) : '')}
              onBlur={field.onBlur}
            />
          </FormControl>
          {hint && <FormDescription>{hint}</FormDescription>}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

export interface SelectOption {
  value: string;
  label: string;
}

export function SelectField({
  name,
  label,
  hint,
  wide,
  required = true,
  options,
  disabled,
  onChange,
}: BaseProps & {
  options: SelectOption[];
  disabled?: boolean | undefined;
  /** Runs after the value is set (to reset a dependent field). */
  onChange?: (value: string) => void;
}) {
  const { control } = useFormContext();
  const { t } = useTranslation('applicationForms');
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem className={span(wide)}>
          <FormLabel required={required}>{label}</FormLabel>
          <Select
            value={(field.value as string) ?? ''}
            onValueChange={(value) => {
              field.onChange(value);
              onChange?.(value);
            }}
            disabled={disabled ?? false}
          >
            <FormControl>
              <SelectTrigger onBlur={field.onBlur}>
                <SelectValue placeholder={t('placeholders.pick')} />
              </SelectTrigger>
            </FormControl>
            <SelectContent>
              {options.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {hint && <FormDescription>{hint}</FormDescription>}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}
