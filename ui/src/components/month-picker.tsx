/**
 * D25, D26: month picker ("2026-10"). Stub — filled in by 31.2.2 (year
 * navigation with MonthHeader, min/max, styling).
 */
import { CalendarRangeIcon } from 'lucide-react';
import * as React from 'react';

import { useRegionConfig, useTranslation } from '../i18n';
import { cn } from '../primitives/lib/utils';
import { formatMonth, formatMonthName } from '../utils/date';

import { Popover, PopoverContent, PopoverTrigger } from './popover';

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

export function MonthPicker({
  value,
  onValueChange,
  placeholder,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- min/max are 31.2.2's
  min: _min,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- min/max are 31.2.2's
  max: _max,
  className,
  ...props
}: MonthPickerProps) {
  const { t } = useTranslation('common');
  const regionConfig = useRegionConfig();
  const [open, setOpen] = React.useState(false);
  const year = value ? value.slice(0, 4) : String(new Date().getFullYear());
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          {...props}
          className={cn(
            'flex h-[var(--control-h,2rem)] w-full items-center justify-between gap-2 rounded-md border border-input bg-transparent px-2.5 text-start outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
            className,
          )}
        >
          <span>
            {value ? formatMonth(value, regionConfig) : (placeholder ?? t('date.pickMonth'))}
          </span>
          <CalendarRangeIcon className="size-4" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent>
        <div className="grid grid-cols-3 gap-1">
          {Array.from({ length: 12 }, (_, i) => i + 1).map((month) => (
            <button
              key={month}
              type="button"
              aria-pressed={value === `${year}-${String(month).padStart(2, '0')}`}
              className="rounded-md px-2 py-1 text-start hover:bg-muted"
              onClick={() => {
                onValueChange(`${year}-${String(month).padStart(2, '0')}`);
                setOpen(false);
              }}
            >
              {formatMonthName(month, regionConfig)}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
