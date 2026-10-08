/**
 * One lesson period's delivery status as a real radiogroup (one tab stop,
 * arrow keys move and select). 56px stacked (icon over word) on phone,
 * 44px inline on desktop. Never colour alone: icon + word on every option,
 * tones reuse the `status-*` tokens `StatusBadge` uses. Labels are props —
 * no `useTranslation` here. Picking NOT_TAUGHT only calls `onChange`; the
 * reason dialog is the page's job.
 */
import type { LessonDeliveryStatus } from '@biddaloy/shared';
import { Check, Contrast, X, type LucideIcon } from 'lucide-react';
import { RadioGroup as RadioGroupPrimitive } from 'radix-ui';

import { cn } from '../primitives/lib/utils';

import { RadioGroup } from './radio';

export type { LessonDeliveryStatus };

export interface LessonStatusGroupProps {
  value: LessonDeliveryStatus | null;
  onChange: (next: LessonDeliveryStatus) => void;
  labels: Record<LessonDeliveryStatus, string>;
  /** Names the period, e.g. "১ম পিরিয়ডের অবস্থা". */
  groupLabel: string;
  disabled?: boolean;
  className?: string;
}

const ORDER: LessonDeliveryStatus[] = ['TAUGHT', 'PARTLY', 'NOT_TAUGHT'];

const ICON: Record<LessonDeliveryStatus, LucideIcon> = {
  TAUGHT: Check,
  PARTLY: Contrast,
  NOT_TAUGHT: X,
};

const SELECTED_TONE: Record<LessonDeliveryStatus, string> = {
  TAUGHT: 'border-status-paid-fg bg-status-paid-bg text-status-paid-fg',
  PARTLY: 'border-status-due-fg bg-status-due-bg text-status-due-fg',
  NOT_TAUGHT: 'border-status-overdue-fg bg-status-overdue-bg text-status-overdue-fg',
};

const UNSELECTED = 'border-border-functional bg-surface text-text-primary hover:bg-muted';

export function LessonStatusGroup({
  value,
  onChange,
  labels,
  groupLabel,
  disabled = false,
  className,
}: LessonStatusGroupProps) {
  return (
    <RadioGroup
      aria-label={groupLabel}
      // Radix expects a string; '' = nothing selected.
      value={value ?? ''}
      onValueChange={(next) => onChange(next as LessonDeliveryStatus)}
      disabled={disabled}
      className={cn('grid grid-cols-3 gap-2', className)}
    >
      {ORDER.map((status) => {
        const Icon = ICON[status];
        return (
          <RadioGroupPrimitive.Item
            key={status}
            value={status}
            className={cn(
              'inline-flex h-14 min-w-0 flex-col items-center justify-center gap-0.5 rounded-md border px-2 text-label outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-surface md:h-11 md:flex-row md:gap-1.5 md:px-3',
              value === status ? SELECTED_TONE[status] : UNSELECTED,
            )}
          >
            <Icon aria-hidden="true" className="size-4 shrink-0" />
            <span className="truncate">{labels[status]}</span>
          </RadioGroupPrimitive.Item>
        );
      })}
    </RadioGroup>
  );
}
