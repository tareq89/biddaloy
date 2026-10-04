/**
 * D26: previous / label / next (and Today) header shared by DatePicker,
 * MonthPicker and MonthGrid. Complete; owned by 31.2.2.
 */
import { ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';

import { useTranslation } from '../i18n';

import { Button } from './button';

export interface MonthHeaderProps {
  /** Already formatted: `formatMonth(...)` or a year. */
  label: string;
  onPrevious: () => void;
  onNext: () => void;
  /** Omitted: no "Today" button (MonthPicker). */
  onToday?: () => void;
  /** Disables the Today button (today is outside the allowed range). */
  todayDisabled?: boolean;
  /** Default `t('date.previousMonth')`. */
  previousLabel?: string;
  /** Default `t('date.nextMonth')`. */
  nextLabel?: string;
  /** When set, the label becomes a button that opens a month/year chooser (DatePicker's
   * year jump for dates of birth, 31.2.2). */
  onLabelClick?: () => void;
  /** `aria-expanded` on that button. */
  labelExpanded?: boolean;
}

export function MonthHeader({
  label,
  onPrevious,
  onNext,
  onToday,
  todayDisabled,
  previousLabel,
  nextLabel,
  onLabelClick,
  labelExpanded,
}: MonthHeaderProps) {
  const { t } = useTranslation('common');
  return (
    <div className="flex items-center gap-2">
      {onLabelClick ? (
        <div className="flex-1">
          <button
            type="button"
            aria-expanded={labelExpanded}
            aria-label={`${label}, ${t('date.chooseMonthYear')}`}
            onClick={onLabelClick}
            className="-ms-2 inline-flex h-[var(--control-h,2rem)] items-center gap-1 rounded-md px-2 text-h3 hover:bg-muted"
          >
            <span aria-live="polite">{label}</span>
            <ChevronDownIcon className="size-4 text-text-secondary" aria-hidden="true" />
          </button>
        </div>
      ) : (
        <p aria-live="polite" className="flex-1 text-h3">
          {label}
        </p>
      )}
      {onToday && (
        <Button type="button" variant="outline" disabled={todayDisabled} onClick={onToday}>
          {t('date.today')}
        </Button>
      )}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        iconOnly
        aria-label={previousLabel ?? t('date.previousMonth')}
        onClick={onPrevious}
      >
        <ChevronLeftIcon className="rtl:rotate-180" aria-hidden="true" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        iconOnly
        aria-label={nextLabel ?? t('date.nextMonth')}
        onClick={onNext}
      >
        <ChevronRightIcon className="rtl:rotate-180" aria-hidden="true" />
      </Button>
    </div>
  );
}
