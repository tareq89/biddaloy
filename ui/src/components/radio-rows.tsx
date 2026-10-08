/**
 * A list of labelled radio rows, each with a title and an optional caption
 * line (e.g. a template list). Legend names the group; `legendHidden` keeps
 * it for screen readers only. Labels are props — no `useTranslation`.
 */
import * as React from 'react';

import { cn } from '../primitives/lib/utils';

import { RadioGroup, RadioGroupItem } from './radio';

export interface RadioRowOption {
  value: string;
  title: string;
  caption?: string;
  disabled?: boolean;
}

export interface RadioRowsProps {
  value: string;
  onValueChange: (next: string) => void;
  options: RadioRowOption[];
  legend: string;
  legendHidden?: boolean;
  className?: string;
}

export function RadioRows({
  value,
  onValueChange,
  options,
  legend,
  legendHidden = false,
  className,
}: RadioRowsProps) {
  const baseId = React.useId();
  const legendId = `${baseId}-legend`;
  return (
    <fieldset className={cn('min-w-0', className)}>
      <legend id={legendId} className={cn('mb-2 text-label', legendHidden && 'sr-only')}>
        {legend}
      </legend>
      <RadioGroup value={value} onValueChange={onValueChange} aria-labelledby={legendId}>
        {options.map((option, i) => {
          const id = `${baseId}-${i}`;
          const selected = value === option.value;
          // Only the title is the <label> (the radio's name); the caption is its
          // description alone. The label's ::after covers the row so the whole
          // row still selects on click.
          return (
            <div
              key={option.value}
              className={cn(
                'relative flex min-h-11 cursor-pointer items-start gap-3 rounded-md border p-3',
                selected ? 'border-primary bg-secondary' : 'border-border-functional bg-surface',
                option.disabled && 'cursor-not-allowed opacity-50',
              )}
            >
              <RadioGroupItem
                id={id}
                value={option.value}
                disabled={option.disabled ?? false}
                {...(option.caption ? { 'aria-describedby': `${id}-caption` } : {})}
                className="mt-0.5"
              />
              <span className="flex min-w-0 flex-col">
                <label
                  htmlFor={id}
                  className={cn(
                    'font-medium after:absolute after:inset-0',
                    option.disabled ? 'cursor-not-allowed' : 'cursor-pointer',
                    selected && 'font-semibold text-secondary-foreground',
                  )}
                >
                  {option.title}
                </label>
                {option.caption && (
                  <span id={`${id}-caption`} className="text-caption text-text-secondary">
                    {option.caption}
                  </span>
                )}
              </span>
            </div>
          );
        })}
      </RadioGroup>
    </fieldset>
  );
}
