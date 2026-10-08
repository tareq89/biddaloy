/**
 * A radio group drawn as cards (pick a certificate kind, pick a language).
 * Same Radix radio group as `RadioGroup`, so arrow keys move + select and
 * Space selects. Each card is named by its title alone and described by its
 * note; the checked card also shows a check mark (not colour alone).
 *
 * A disabled option shows `disabledReason` under its title. Radix skips a
 * disabled radio on Tab and arrows, so the reasons are also the group's
 * description (one visually hidden line), which a screen reader reads on
 * entering the group.
 */
import { CheckIcon } from 'lucide-react';
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
  const disabledNotes = options
    .filter((o) => o.disabled && o.disabledReason)
    .map((o) => `${o.title}: ${o.disabledReason}`);
  const disabledNotesId = disabledNotes.length > 0 ? `${id}-disabled` : undefined;
  return (
    <>
      <RadioGroupPrimitive.Root
        aria-label={label}
        aria-describedby={disabledNotesId}
        value={value ?? null}
        onValueChange={onValueChange}
        data-slot="choice-cards"
        className={cn('grid gap-3', COLUMNS[columns])}
      >
        {options.map((option, index) => {
          const note = option.disabled ? option.disabledReason : option.description;
          const titleId = `${id}-${index}-title`;
          const noteId = note ? `${id}-${index}` : undefined;
          return (
            <RadioGroupPrimitive.Item
              key={option.value}
              value={option.value}
              disabled={option.disabled}
              aria-labelledby={titleId}
              aria-describedby={noteId}
              className={cn(
                'relative flex min-h-11 flex-col items-start gap-1 rounded-lg border border-border-subtle bg-surface p-4 pe-10 text-start shadow-e1 outline-none',
                'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                'data-[state=checked]:border-primary data-[state=checked]:bg-secondary',
                'disabled:cursor-not-allowed disabled:bg-muted disabled:text-text-secondary',
              )}
            >
              <span id={titleId} className="font-semibold">
                {option.title}
              </span>
              {note && (
                <span id={noteId} className="text-caption text-text-secondary">
                  {note}
                </span>
              )}
              <RadioGroupPrimitive.Indicator className="absolute end-3 top-4 text-primary">
                <CheckIcon className="size-5" aria-hidden="true" />
              </RadioGroupPrimitive.Indicator>
            </RadioGroupPrimitive.Item>
          );
        })}
      </RadioGroupPrimitive.Root>
      {disabledNotesId && (
        <span id={disabledNotesId} className="sr-only">
          {disabledNotes.join('. ')}
        </span>
      )}
    </>
  );
}
