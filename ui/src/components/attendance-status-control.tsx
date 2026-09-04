/**
 * [9.6] The one status-setting control the teacher marking screen uses
 * for every row, in two shapes:
 *
 * - `compact` (default) — a phone-width row's trailing pill. Tapping it
 *   opens a popover listing all four statuses plus, for `LATE`, a
 *   minutes-late field. The 95% case (PRESENT ⇄ ABSENT) is handled by the
 *   *row* itself (`-roster-marker.tsx`'s own `onClick`) — this popover is
 *   for the other two statuses and their detail, which is why it is a
 *   "more" affordance rather than the row's primary tap target.
 * - `expanded` — all four options inline, for the desktop-keyboard staff
 *   room layout where screen width is not the constraint.
 *
 * Never colour alone: every option renders an icon *and* a word, reusing
 * `status-badge.tsx`'s own `status-*` tone tokens rather than inventing a
 * new palette — PRESENT/success, ABSENT/danger, LATE/warning,
 * LEAVE/info, matching the tones `StatusBadge` already uses elsewhere for
 * the same shape of meaning (done/blocked/pending/informational).
 *
 * Built entirely from `Button` and the existing `Popover` wrapper — no
 * new primitive. The popover's focus trap and return-focus-on-close are
 * Radix's own behaviour (same primitive family `dialog.tsx` and
 * `sync-status.tsx` already exercise), so this component doesn't
 * reimplement either.
 */
import { AttendanceStatus } from '@biddaloy/shared';
import { Calendar, Check, Clock, X, type LucideIcon } from 'lucide-react';
import * as React from 'react';

import { useTranslation } from '../i18n';
import { cn } from '../primitives/lib/utils';

import { Button } from './button';
import { Input } from './input';
import { Popover, PopoverContent, PopoverHeader, PopoverTitle, PopoverTrigger } from './popover';

export type AttendanceStatusControlVariant = 'compact' | 'expanded';

export interface AttendanceStatusControlProps {
  value: AttendanceStatus | null;
  onChange: (next: AttendanceStatus) => void;
  disabled?: boolean;
  /** `'compact'` -> row's trailing pill + "more" popover (default).
   * `'expanded'` -> all four options inline, for wide layouts. */
  variant?: AttendanceStatusControlVariant;
  minutesLate?: number | null;
  onMinutesLateChange?: (minutes: number | null) => void;
  /** For the accessible name and the live-region-friendly label — every
   * option's accessible name includes the student's name, not just the
   * status word, so a screen-reader user tabbing through a roster of 40
   * rows always knows whose mark they are about to change. */
  studentName: string;
  className?: string;
}

const STATUS_ORDER: AttendanceStatus[] = [
  AttendanceStatus.PRESENT,
  AttendanceStatus.ABSENT,
  AttendanceStatus.LATE,
  AttendanceStatus.LEAVE,
];

const STATUS_ICON: Record<AttendanceStatus, LucideIcon> = {
  [AttendanceStatus.PRESENT]: Check,
  [AttendanceStatus.ABSENT]: X,
  [AttendanceStatus.LATE]: Clock,
  [AttendanceStatus.LEAVE]: Calendar,
};

/** Same four tones `status-badge.tsx` maps its domains onto — reused by
 * token name, not re-derived, so a theme change to one moves both. */
const STATUS_TONE_CLASSES: Record<AttendanceStatus, string> = {
  [AttendanceStatus.PRESENT]: 'text-status-paid-fg bg-status-paid-bg',
  [AttendanceStatus.ABSENT]: 'text-status-overdue-fg bg-status-overdue-bg',
  [AttendanceStatus.LATE]: 'text-status-due-fg bg-status-due-bg',
  [AttendanceStatus.LEAVE]: 'text-status-partial-fg bg-status-partial-bg',
};

const UNMARKED_TONE_CLASSES = 'text-muted-foreground bg-muted';

function statusLabelKey(status: AttendanceStatus): string {
  return `statusControl.status.${status}`;
}

export function AttendanceStatusControl({
  value,
  onChange,
  disabled = false,
  variant = 'compact',
  minutesLate,
  onMinutesLateChange,
  studentName,
  className,
}: AttendanceStatusControlProps) {
  const { t } = useTranslation('attendance');
  const [open, setOpen] = React.useState(false);

  function handleSelect(status: AttendanceStatus) {
    onChange(status);
    if (status !== AttendanceStatus.LATE) setOpen(false);
  }

  function minutesLateField() {
    if (!onMinutesLateChange) return null;
    return (
      <div className="flex flex-col gap-1">
        <label
          htmlFor={`minutes-late-${studentName}`}
          className="text-xs font-medium text-muted-foreground"
        >
          {t('statusControl.minutesLateLabel')}
        </label>
        <Input
          id={`minutes-late-${studentName}`}
          type="number"
          min={0}
          max={1440}
          inputMode="numeric"
          disabled={disabled}
          value={minutesLate ?? ''}
          onChange={(event) => {
            const raw = event.target.value;
            onMinutesLateChange(raw === '' ? null : Number(raw));
          }}
        />
      </div>
    );
  }

  if (variant === 'expanded') {
    return (
      <div
        role="group"
        aria-label={t('statusControl.groupLabel', { name: studentName })}
        className={cn('flex flex-col gap-2', className)}
      >
        <div className="flex flex-wrap gap-1.5">
          {STATUS_ORDER.map((status) => {
            const Icon = STATUS_ICON[status];
            const selected = value === status;
            return (
              <Button
                key={status}
                type="button"
                variant={selected ? 'default' : 'outline'}
                disabled={disabled}
                aria-pressed={selected}
                aria-label={t('statusControl.optionAccessibleLabel', {
                  name: studentName,
                  status: t(statusLabelKey(status)),
                })}
                onClick={() => handleSelect(status)}
                // 48px minimum in the expanded variant, per the plan.
                className="min-h-12 min-w-12 gap-1.5"
              >
                <Icon aria-hidden="true" className="size-4" />
                <span>{t(statusLabelKey(status))}</span>
              </Button>
            );
          })}
        </div>
        {value === AttendanceStatus.LATE && minutesLateField()}
      </div>
    );
  }

  const Icon = value ? STATUS_ICON[value] : null;
  const toneClasses = value ? STATUS_TONE_CLASSES[value] : UNMARKED_TONE_CLASSES;
  const currentLabel = value ? t(statusLabelKey(value)) : t('statusControl.unmarked');

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          disabled={disabled}
          aria-label={t('statusControl.triggerAccessibleLabel', {
            name: studentName,
            status: currentLabel,
          })}
          // 44px minimum touch target in the compact variant.
          className={cn(
            'min-h-11 min-w-11 gap-1.5 rounded-full px-3',
            toneClasses,
            'hover:opacity-90',
            className,
          )}
        >
          {Icon && <Icon aria-hidden="true" className="size-4" />}
          <span className="text-xs font-medium">{currentLabel}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        aria-label={t('statusControl.popoverLabel', { name: studentName })}
        className="w-56"
      >
        <PopoverHeader>
          <PopoverTitle>{studentName}</PopoverTitle>
        </PopoverHeader>
        <div className="flex flex-col gap-1">
          {STATUS_ORDER.map((status) => {
            const OptionIcon = STATUS_ICON[status];
            const selected = value === status;
            return (
              <Button
                key={status}
                type="button"
                variant={selected ? 'default' : 'ghost'}
                disabled={disabled}
                aria-pressed={selected}
                onClick={() => handleSelect(status)}
                className="min-h-11 justify-start gap-2"
              >
                <OptionIcon aria-hidden="true" className="size-4" />
                <span>{t(statusLabelKey(status))}</span>
              </Button>
            );
          })}
        </div>
        {value === AttendanceStatus.LATE && <div className="mt-2">{minutesLateField()}</div>}
      </PopoverContent>
    </Popover>
  );
}
