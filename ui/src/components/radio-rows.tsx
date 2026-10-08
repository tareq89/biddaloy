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
  return (
    <fieldset className={cn('min-w-0', className)}>
      <legend className={cn('mb-2 text-label', legendHidden && 'sr-only')}>{legend}</legend>
      <RadioGroup value={value} onValueChange={onValueChange}>
        {options.map((option, i) => {
          const id = `${baseId}-${i}`;
          const selected = value === option.value;
          return (
            <label
              key={option.value}
              htmlFor={id}
              className={cn(
                'flex min-h-11 cursor-pointer items-start gap-3 rounded-md border p-3',
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
                <span
                  className={cn(
                    'font-medium',
                    selected && 'font-semibold text-secondary-foreground',
                  )}
                >
                  {option.title}
                </span>
                {option.caption && (
                  <span id={`${id}-caption`} className="text-caption text-text-secondary">
                    {option.caption}
                  </span>
                )}
              </span>
            </label>
          );
        })}
      </RadioGroup>
    </fieldset>
  );
}
