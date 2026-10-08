/**
 * A radio group drawn as cards (pick a certificate kind, pick a language).
 * Same Radix radio group as `RadioGroup`, so arrow keys move + select and
 * Space selects. A disabled option shows `disabledReason` under its title,
 * linked with `aria-describedby`.
 */
import { RadioGroup as RadioGroupPrimitive } from 'radix-ui';
import * as React from 'react';

import { cn } from '../primitives/lib/utils';

export interface ChoiceCardOption {
  value: string;
  title: string;
  description?: string;
  disabled?: boolean;
  /** Shown instead of `description` when the option is disabled. */
  disabledReason?: string;
}

export interface ChoiceCardsProps {
  /** Group name, read by screen readers. */
  label: string;
  value: string | undefined;
  onValueChange: (value: string) => void;
  options: readonly ChoiceCardOption[];
  /** Columns from `md` up; phone is always 1. */
  columns?: 1 | 2 | 3;
}

const COLUMNS = { 1: '', 2: 'md:grid-cols-2', 3: 'md:grid-cols-3' } as const;

export function ChoiceCards({
  label,
  value,
  onValueChange,
  options,
  columns = 1,
}: ChoiceCardsProps) {
  const id = React.useId();
  return (
    <RadioGroupPrimitive.Root
      aria-label={label}
      value={value ?? null}
      onValueChange={onValueChange}
      data-slot="choice-cards"
      className={cn('grid gap-3', COLUMNS[columns])}
    >
      {options.map((option, index) => {
        const note = option.disabled ? option.disabledReason : option.description;
        const noteId = note ? `${id}-${index}` : undefined;
        return (
          <RadioGroupPrimitive.Item
            key={option.value}
            value={option.value}
            disabled={option.disabled}
            aria-describedby={noteId}
            className={cn(
              'flex min-h-11 flex-col items-start gap-1 rounded-lg border border-border-subtle bg-surface p-4 text-start shadow-e1 outline-none',
              'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
              'data-[state=checked]:border-primary data-[state=checked]:bg-secondary',
              'disabled:cursor-not-allowed disabled:bg-muted disabled:text-text-secondary',
            )}
          >
            <span className="font-semibold">{option.title}</span>
            {note && (
              <span id={noteId} className="text-caption text-text-secondary">
                {note}
              </span>
            )}
          </RadioGroupPrimitive.Item>
        );
      })}
    </RadioGroupPrimitive.Root>
  );
}
