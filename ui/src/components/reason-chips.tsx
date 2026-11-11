/**
 * [99.W0] A row of toggle chips plus one free-text field. Picking a chip fills
 * the text (still editable); a chip is pressed while the text equals it.
 * `error` is the caller's message, shown while the text is under `minLength`.
 * Labels are props — no `useTranslation`.
 */
import * as React from 'react';

import { cn } from '../primitives/lib/utils';

import { Label } from './label';
import { Textarea } from './textarea';

export interface ReasonChipsProps {
  chips: readonly string[];
  value: string;
  onChange: (value: string) => void;
  textLabel: string;
  minLength: number;
  error?: string;
  className?: string;
}

export function ReasonChips({
  chips,
  value,
  onChange,
  textLabel,
  minLength,
  error,
  className,
}: ReasonChipsProps) {
  const uid = React.useId();
  const showError = Boolean(error) && value.trim().length < minLength;
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div className="flex flex-wrap gap-2">
        {chips.map((chip) => {
          const active = value === chip;
          return (
            <button
              key={chip}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(chip)}
              className={cn(
                'min-h-11 rounded-lg border px-3 py-1.5 text-sm',
                active
                  ? 'border-primary bg-secondary'
                  : 'border-border-subtle bg-surface hover:bg-muted',
              )}
            >
              {chip}
            </button>
          );
        })}
      </div>
      <Label htmlFor={`${uid}-text`}>{textLabel}</Label>
      <Textarea
        id={`${uid}-text`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={showError || undefined}
        aria-describedby={showError ? `${uid}-err` : undefined}
      />
      {showError && (
        <p id={`${uid}-err`} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
