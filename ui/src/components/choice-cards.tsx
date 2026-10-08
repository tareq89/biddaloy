/**
 * Radio cards for "how do you want to start": the whole card is the radio
 * (not a dot inside it). Labels are props — no `useTranslation`.
 */
import type { LucideIcon } from 'lucide-react';
import { RadioGroup as RadioGroupPrimitive } from 'radix-ui';

import { cn } from '../primitives/lib/utils';

import { RadioGroup } from './radio';

export interface ChoiceCardOption {
  value: string;
  title: string;
  description?: string;
  icon?: LucideIcon;
}

/** Exactly one of `label` / `labelledBy`: the radiogroup always has a name. */
export type ChoiceCardsProps = {
  value: string;
  onValueChange: (next: string) => void;
  options: ChoiceCardOption[];
  className?: string;
} & (
  | {
      /** Used as `aria-label` when there is no visible heading. */
      label: string;
      labelledBy?: never;
    }
  | {
      /** Id of the element that names the group. */
      labelledBy: string;
      label?: never;
    }
);

export function ChoiceCards({
  value,
  onValueChange,
  options,
  labelledBy,
  label,
  className,
}: ChoiceCardsProps) {
  return (
    <RadioGroup
      value={value}
      onValueChange={onValueChange}
      {...(labelledBy ? { 'aria-labelledby': labelledBy } : {})}
      {...(label ? { 'aria-label': label } : {})}
      className={cn('grid gap-3 md:grid-cols-3', className)}
    >
      {options.map(({ value: optionValue, title, description, icon: Icon }) => (
        <RadioGroupPrimitive.Item
          key={optionValue}
          value={optionValue}
          className={cn(
            'flex min-h-11 items-start gap-3 rounded-lg border p-4 text-start outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background md:flex-col',
            value === optionValue
              ? 'border-2 border-primary bg-secondary'
              : 'border-border-functional bg-surface hover:bg-muted',
          )}
        >
          {Icon && <Icon aria-hidden="true" className="size-5 shrink-0" />}
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="font-medium">{title}</span>
            {description && <span className="text-caption text-text-secondary">{description}</span>}
          </span>
        </RadioGroupPrimitive.Item>
      ))}
    </RadioGroup>
  );
}
