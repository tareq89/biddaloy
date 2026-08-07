/**
 * Typed entry (`formatDate`/`parseDate`, either digit system) plus a
 * point-and-click month grid — typing a date is faster than clicking
 * through months, so the input is the primary path and the calendar is a
 * secondary affordance, not the other way around. No `react-day-picker`
 * dependency: the grid here is small enough to hand-roll with the roving-
 * tabindex + arrow-key pattern directly, and it needs to render Bengali
 * numerals via this package's own `renderDigits`, which an off-the-shelf
 * calendar library has no reason to know about.
 */
import * as React from 'react';

import { Popover, PopoverContent, PopoverTrigger } from '../primitives/popover';
import { formatDate, parseDate } from '../utils/date';
import { renderDigits } from '../utils/digits';
import type { RegionConfig } from '../utils/region-config';

import { Button } from './button';
import { Input } from './input';

export interface DatePickerProps {
  value: Date | undefined;
  onValueChange: (date: Date | undefined) => void;
  config: RegionConfig;
  'aria-label': string;
  openCalendarLabel?: string;
  previousMonthLabel?: string;
  nextMonthLabel?: string;
}

export function DatePicker({
  value,
  onValueChange,
  config,
  openCalendarLabel = 'Open calendar',
  previousMonthLabel = 'Previous month',
  nextMonthLabel = 'Next month',
  ...props
}: DatePickerProps) {
  const [open, setOpen] = React.useState(false);
  const [text, setText] = React.useState(() => (value ? formatDate(value, config) : ''));
  const [viewMonth, setViewMonth] = React.useState(() => value ?? new Date());

  React.useEffect(() => {
    setText(value ? formatDate(value, config) : '');
    if (value) setViewMonth(value);
  }, [value, config]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div className="flex gap-1.5">
        <Input
          {...props}
          placeholder="YYYY-MM-DD"
          value={text}
          onChange={(event) => {
            const raw = event.target.value;
            setText(raw);
            if (raw.trim() === '') {
              onValueChange(undefined);
              return;
            }
            try {
              const date = parseDate(raw);
              onValueChange(date);
              setViewMonth(date);
            } catch {
              // Typing in progress ("2024-01") isn't a full date yet —
              // don't clobber the last committed value.
            }
          }}
        />
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" iconOnly aria-label={openCalendarLabel}>
            <span aria-hidden="true">▾</span>
          </Button>
        </PopoverTrigger>
      </div>
      <PopoverContent className="w-auto p-2">
        <Calendar
          month={viewMonth}
          selected={value}
          config={config}
          previousMonthLabel={previousMonthLabel}
          nextMonthLabel={nextMonthLabel}
          onMonthChange={setViewMonth}
          onSelect={(date) => {
            onValueChange(date);
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

interface CalendarProps {
  month: Date;
  selected: Date | undefined;
  config: RegionConfig;
  previousMonthLabel: string;
  nextMonthLabel: string;
  onMonthChange: (date: Date) => void;
  onSelect: (date: Date) => void;
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** Exported for its own story/tests; not part of the package's public
 * `components` surface (not in `index.ts`) — `DatePicker` is the real
 * public API, this is its implementation detail. */
export function Calendar({
  month,
  selected,
  config,
  previousMonthLabel,
  nextMonthLabel,
  onMonthChange,
  onSelect,
}: CalendarProps) {
  const year = month.getFullYear();
  const monthIndex = month.getMonth();
  const firstWeekday = new Date(year, monthIndex, 1).getDay();
  const total = daysInMonth(year, monthIndex);
  const days: Array<number | null> = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: total }, (_, i) => i + 1),
  ];
  const weeks: Array<Array<number | null>> = [];
  for (let i = 0; i < days.length; i += 7) {
    weeks.push(days.slice(i, i + 7));
  }

  // Jan 7–13, 2024 is a Sunday-through-Saturday week — an arbitrary but
  // real week, used only so `Intl.DateTimeFormat` has 7 consecutive dates
  // to format. `config.locale` drives the actual language, e.g. "Sun" for
  // `en-BD`, "রবি" for `bn-BD`.
  const weekdayLabels = React.useMemo(() => {
    const formatter = new Intl.DateTimeFormat(config.locale, { weekday: 'short' });
    return Array.from({ length: 7 }, (_, i) => formatter.format(new Date(2024, 0, 7 + i)));
  }, [config.locale]);

  const [focusedDay, setFocusedDay] = React.useState(() =>
    selected && selected.getFullYear() === year && selected.getMonth() === monthIndex
      ? selected.getDate()
      : 1,
  );
  const gridRef = React.useRef<HTMLDivElement>(null);
  // Set at the *start* of a keyboard move, before the month/day state
  // change that can replace the currently-focused button with a different
  // DOM node (crossing a month boundary changes both the leading-blank
  // count and the day total, so the old node isn't reliably reused) — by
  // the time the effect below runs, `document.activeElement` may already
  // have reverted to `<body>` because that node is gone. Capturing intent
  // up front, instead of inferring it after the fact, is what makes the
  // refocus reliable across that boundary.
  const hadFocusRef = React.useRef(false);

  React.useEffect(() => {
    if (focusedDay > total) setFocusedDay(total);
  }, [total, focusedDay]);

  React.useEffect(() => {
    if (!hadFocusRef.current) return;
    hadFocusRef.current = false;
    gridRef.current?.querySelector<HTMLButtonElement>('[data-focused="true"]')?.focus();
  }, [focusedDay, month]);

  function moveFocus(delta: number) {
    hadFocusRef.current = !!gridRef.current?.contains(document.activeElement);
    const next = focusedDay + delta;
    if (next < 1) {
      const prevMonth = new Date(year, monthIndex - 1, 1);
      const prevMonthLength = daysInMonth(prevMonth.getFullYear(), prevMonth.getMonth());
      onMonthChange(prevMonth);
      setFocusedDay(prevMonthLength + next);
    } else if (next > total) {
      onMonthChange(new Date(year, monthIndex + 1, 1));
      setFocusedDay(next - total);
    } else {
      setFocusedDay(next);
    }
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          iconOnly
          aria-label={previousMonthLabel}
          onClick={() => onMonthChange(new Date(year, monthIndex - 1, 1))}
        >
          <span aria-hidden="true">‹</span>
        </Button>
        <span aria-live="polite" className="text-sm font-medium">
          {renderDigits(`${year}-${String(monthIndex + 1).padStart(2, '0')}`, config.numerals)}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          iconOnly
          aria-label={nextMonthLabel}
          onClick={() => onMonthChange(new Date(year, monthIndex + 1, 1))}
        >
          <span aria-hidden="true">›</span>
        </Button>
      </div>
      {/* `role="grid"` requires `row` children containing `columnheader`/
       * `gridcell` cells — each `role="row"` div below uses `display:
       * contents` (the `contents` class) so it disappears from the CSS
       * box tree entirely, letting its children still lay out against
       * this element's `grid-cols-7`, while still existing in the
       * accessibility tree to satisfy the required grid hierarchy. */}
      <div ref={gridRef} role="grid" aria-label="Calendar" className="grid grid-cols-7 gap-1">
        <div role="row" className="contents">
          {weekdayLabels.map((label, index) => (
            <span
              key={index}
              role="columnheader"
              aria-label={label}
              className="text-center text-xs text-muted-foreground"
            >
              {label}
            </span>
          ))}
        </div>
        {weeks.map((week, weekIndex) => (
          <div key={weekIndex} role="row" className="contents">
            {week.map((day, dayIndex) => {
              if (day === null) {
                return (
                  <span key={`blank-${weekIndex}-${dayIndex}`} role="gridcell" aria-hidden="true" />
                );
              }
              const date = new Date(year, monthIndex, day);
              const isFocused = day === focusedDay;
              const isSelected = selected ? sameDay(date, selected) : false;
              return (
                <button
                  key={day}
                  type="button"
                  role="gridcell"
                  data-focused={isFocused}
                  tabIndex={isFocused ? 0 : -1}
                  aria-selected={isSelected}
                  className="rounded-md p-1.5 text-sm hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring aria-selected:bg-primary aria-selected:text-primary-foreground"
                  onClick={() => onSelect(date)}
                  onKeyDown={(event) => {
                    if (event.key === 'ArrowRight') {
                      event.preventDefault();
                      moveFocus(1);
                    } else if (event.key === 'ArrowLeft') {
                      event.preventDefault();
                      moveFocus(-1);
                    } else if (event.key === 'ArrowDown') {
                      event.preventDefault();
                      moveFocus(7);
                    } else if (event.key === 'ArrowUp') {
                      event.preventDefault();
                      moveFocus(-7);
                    } else if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      onSelect(date);
                    }
                  }}
                >
                  {renderDigits(String(day), config.numerals)}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
