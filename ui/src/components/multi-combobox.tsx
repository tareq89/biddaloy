/**
 * Pick-many variant of `Combobox`: same WAI-ARIA wiring (focus stays on the
 * input, `aria-activedescendant`, always-mounted polite live region), but the
 * listbox is `aria-multiselectable`, Enter/click toggles and keeps the list
 * open, and the chosen values show as removable chips above the input.
 */
import { X } from 'lucide-react';
import * as React from 'react';

import { useTranslation } from '../i18n';
import { Popover, PopoverAnchor, PopoverContent } from '../primitives/popover';
import { toLatinDigits } from '../utils/digits';

import type { ComboboxOption } from './combobox';
import { Input } from './input';

export interface MultiComboboxOption extends ComboboxOption {
  /** Second, muted line under the label (a role, a class). */
  description?: string;
}

export interface MultiComboboxProps extends Omit<
  React.ComponentProps<typeof Input>,
  | 'onChange'
  | 'value'
  | 'role'
  | 'aria-expanded'
  | 'aria-controls'
  | 'aria-autocomplete'
  | 'aria-activedescendant'
> {
  options: MultiComboboxOption[];
  value: string[];
  onValueChange: (value: string[]) => void;
  'aria-label': string;
  emptyText?: string;
  /** At most this many values; the other options turn `aria-disabled`. */
  max?: number | undefined;
}

export function MultiCombobox({
  options,
  value,
  onValueChange,
  placeholder,
  emptyText,
  max,
  onFocus,
  ...props
}: MultiComboboxProps) {
  const { t } = useTranslation();
  placeholder ??= t('form.selectPlaceholder');
  emptyText ??= t('table.empty');
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [activeIndex, setActiveIndex] = React.useState(-1);
  const listboxId = React.useId();
  const inputRef = React.useRef<HTMLInputElement>(null);

  const trimmed = toLatinDigits(query.trim().toLowerCase());
  const filtered =
    trimmed === ''
      ? options
      : options.filter((option) => toLatinDigits(option.label.toLowerCase()).includes(trimmed));
  const atMax = max !== undefined && value.length >= max;
  const chips = value.flatMap((v) => options.find((option) => option.value === v) ?? []);

  function optionId(index: number): string {
    return `${listboxId}-option-${index}`;
  }

  function remove(optionValue: string) {
    onValueChange(value.filter((v) => v !== optionValue));
    inputRef.current?.focus();
  }

  function toggle(option: ComboboxOption) {
    if (value.includes(option.value)) {
      onValueChange(value.filter((v) => v !== option.value));
    } else if (!atMax) {
      onValueChange([...value, option.value]);
    } else {
      return;
    }
    setQuery('');
    setActiveIndex(0);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div className="flex flex-col gap-2">
        {chips.length > 0 && (
          <ul aria-label={t('multiCombobox.selected')} className="flex flex-wrap gap-2">
            {chips.map((option) => (
              <li
                key={option.value}
                className="inline-flex min-h-11 items-center gap-1 rounded-full border border-border-subtle bg-muted px-3 text-body md:min-h-8"
              >
                {option.label}
                <button
                  type="button"
                  aria-label={t('multiCombobox.remove', { label: option.label })}
                  className="inline-flex size-11 items-center justify-center rounded-full text-text-secondary hover:text-text-primary md:size-8"
                  onClick={() => remove(option.value)}
                >
                  <X className="size-4" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <PopoverAnchor asChild>
          <Input
            {...props}
            ref={inputRef}
            role="combobox"
            aria-expanded={open}
            aria-controls={listboxId}
            aria-autocomplete="list"
            aria-activedescendant={open && activeIndex >= 0 ? optionId(activeIndex) : undefined}
            placeholder={placeholder}
            value={query}
            onFocus={(event) => {
              setOpen(true);
              onFocus?.(event);
            }}
            onChange={(event) => {
              setQuery(event.target.value);
              setOpen(true);
              setActiveIndex(0);
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setOpen(true);
                setActiveIndex((index) => Math.min(index + 1, filtered.length - 1));
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                setActiveIndex((index) => Math.max(index - 1, 0));
              } else if (event.key === 'Enter') {
                if (open && activeIndex >= 0) {
                  event.preventDefault();
                  const option = filtered[activeIndex];
                  if (option) toggle(option);
                }
              } else if (event.key === 'Backspace') {
                if (query === '' && value.length > 0) {
                  onValueChange(value.slice(0, -1));
                }
              } else if (event.key === 'Escape') {
                setOpen(false);
              }
            }}
          />
        </PopoverAnchor>
      </div>
      <div aria-live="polite" className="sr-only">
        {open ? t('combobox.results', { count: filtered.length }) : ''}
      </div>
      <PopoverContent
        className="w-(--radix-popover-trigger-width) p-1"
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        <div
          role="listbox"
          aria-multiselectable="true"
          id={listboxId}
          aria-label={props['aria-label']}
        >
          {filtered.length === 0 && (
            <div className="px-2 py-1.5 text-sm text-muted-foreground">{emptyText}</div>
          )}
          {filtered.map((option, index) => {
            const selected = value.includes(option.value);
            const disabled = atMax && !selected;
            return (
              // Focus stays on the input; see `combobox.tsx` for why an option
              // is never itself focusable.
              // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/interactive-supports-focus
              <div
                key={option.value}
                id={optionId(index)}
                role="option"
                aria-selected={selected}
                aria-disabled={disabled || undefined}
                data-active={index === activeIndex}
                className="flex min-h-11 cursor-default flex-col justify-center rounded-md px-2 py-1.5 text-sm aria-disabled:opacity-50 aria-selected:font-semibold data-[active=true]:bg-accent md:min-h-8"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => toggle(option)}
              >
                {option.label}
                {option.description && (
                  <span className="text-caption font-normal text-text-secondary">
                    {option.description}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
