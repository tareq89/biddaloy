/** D25, D26: month picker ("2026-10") — trigger button + year-stepped month grid. */
import { CalendarRangeIcon } from 'lucide-react';
import * as React from 'react';

import { useRegionConfig, useTranslation } from '../i18n';
import type { RegionConfig } from '../i18n/region-config';
import { cn } from '../primitives/lib/utils';
import { formatMonth, formatMonthName } from '../utils/date';
import { renderDigits } from '../utils/digits';

import { MonthHeader } from './month-header';
import { Popover, PopoverContent, PopoverTrigger } from '../primitives/popover';

export interface MonthPickerProps extends Omit<
  React.ComponentProps<'button'>,
  'value' | 'onChange' | 'children' | 'aria-label'
> {
  /** `"2026-10"`. */
  value: string | undefined;
  onValueChange: (value: string) => void;
  /** Default `t('date.pickMonth')`. */
  placeholder?: string;
  /** `"YYYY-MM"`, inclusive. */
  min?: string;
  max?: string;
  'aria-label': string;
}

/** Shared trigger look for DatePicker and MonthPicker (PATTERN: DatePicker). */
export const pickerTriggerClass =
  'flex h-[var(--control-h,2rem)] w-full items-center justify-between gap-2 rounded-md border border-border-functional bg-surface px-3 text-start text-body-lg text-text-primary outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:bg-muted md:text-body';

const pad = (m: number) => String(m).padStart(2, '0');

/** 12 month buttons for one year. Module-shared with DatePicker's year jump
 * (not exported from `index.ts`). */
export function MonthButtons({
  year,
  selected,
  min,
  max,
  onPick,
  config,
}: {
  year: number;
  /** `"YYYY-MM"` */
  selected: string | undefined;
  min?: string;
  max?: string;
  onPick: (month: number) => void;
  config: RegionConfig;
}) {
  const now = new Date();
  const current = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
  return (
    <div className="grid grid-cols-3 gap-1">
      {Array.from({ length: 12 }, (_, i) => i + 1).map((month) => {
        const key = `${year}-${pad(month)}`;
        const isSelected = selected === key;
        return (
          <button
            key={month}
            type="button"
            aria-pressed={isSelected}
            disabled={(min !== undefined && key < min) || (max !== undefined && key > max)}
            className={cn(
              'h-11 rounded-md text-label hover:bg-muted disabled:pointer-events-none disabled:opacity-40 md:h-9',
              key === current &&
                !isSelected &&
                'font-semibold text-primary ring-2 ring-primary ring-inset',
              isSelected && 'bg-primary font-semibold text-primary-foreground hover:bg-primary',
            )}
            onClick={() => onPick(month)}
          >
            {formatMonthName(month, config)}
          </button>
        );
      })}
    </div>
  );
}

export function MonthPicker({
  value,
  onValueChange,
  placeholder,
  min,
  max,
  className,
  ...props
}: MonthPickerProps) {
  const { t } = useTranslation('common');
  const config = useRegionConfig();
  const [open, setOpen] = React.useState(false);
  const valueYear = value ? Number(value.slice(0, 4)) : new Date().getFullYear();
  const [viewYear, setViewYear] = React.useState(valueYear);
  React.useEffect(() => setViewYear(valueYear), [valueYear]);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          {...props}
          className={cn(pickerTriggerClass, !value && 'text-text-secondary', className)}
        >
          <span>{value ? formatMonth(value, config) : (placeholder ?? t('date.pickMonth'))}</span>
          <CalendarRangeIcon className="size-4 text-text-secondary" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-full rounded-lg border border-border-subtle bg-surface p-3 shadow-e2 md:w-72">
        <div className="space-y-2">
          <MonthHeader
            label={renderDigits(String(viewYear), config.numerals)}
            previousLabel={t('date.previousYear')}
            nextLabel={t('date.nextYear')}
            onPrevious={() => setViewYear((y) => y - 1)}
            onNext={() => setViewYear((y) => y + 1)}
          />
          <MonthButtons
            year={viewYear}
            selected={value}
            min={min}
            max={max}
            config={config}
            onPick={(month) => {
              onValueChange(`${viewYear}-${pad(month)}`);
              setOpen(false);
            }}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}
