/**
 * The WAI-ARIA combobox pattern: focus stays on the `<input role="combobox">`
 * the entire time — the listbox popup is never itself focused, the current
 * option is "virtually focused" via `aria-activedescendant`, and result
 * counts announce through a polite live region. Built on `primitives/
 * popover` rather than a listbox/command-palette library (`cmdk` and
 * similar implement a different interaction model, where focus moves into
 * the list) — `onOpenAutoFocus`/`onCloseAutoFocus` are both suppressed on
 * `PopoverContent` for exactly this reason, so Radix's own default focus
 * management doesn't fight the pattern.
 */
import * as React from 'react';

import { Popover, PopoverAnchor, PopoverContent } from '../primitives/popover';

import { Input } from './input';

export interface ComboboxOption {
  value: string;
  label: string;
}

export interface ComboboxProps extends Omit<
  React.ComponentProps<typeof Input>,
  | 'onChange'
  | 'value'
  | 'role'
  | 'aria-expanded'
  | 'aria-controls'
  | 'aria-autocomplete'
  | 'aria-activedescendant'
> {
  options: ComboboxOption[];
  value: string | null;
  onValueChange: (value: string | null) => void;
  'aria-label': string;
  emptyText?: string;
  /** Template for the polite live-region announcement on every filter
   * change — defaults to English; a Bangla-locale caller passes its own
   * translated template until FormField/i18next wiring exists. */
  announceResults?: (count: number) => string;
}

export function Combobox({
  options,
  value,
  onValueChange,
  placeholder,
  emptyText = 'No results',
  announceResults = (count) => `${count} result${count === 1 ? '' : 's'}`,
  onFocus,
  ...props
}: ComboboxProps) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [activeIndex, setActiveIndex] = React.useState(-1);
  const listboxId = React.useId();

  const selectedOption = options.find((option) => option.value === value) ?? null;
  const trimmed = query.trim().toLowerCase();
  const filtered =
    trimmed === ''
      ? options
      : options.filter((option) => option.label.toLowerCase().includes(trimmed));

  function optionId(index: number): string {
    return `${listboxId}-option-${index}`;
  }

  function selectOption(option: ComboboxOption) {
    onValueChange(option.value);
    setQuery('');
    setOpen(false);
    setActiveIndex(-1);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <Input
          {...props}
          role="combobox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={open && activeIndex >= 0 ? optionId(activeIndex) : undefined}
          placeholder={placeholder}
          value={open ? query : (selectedOption?.label ?? '')}
          onFocus={(event) => {
            // Seed `query` from the current selection rather than leaving
            // it at its last value (often '' right after a prior
            // selection) — otherwise the input goes blank the instant it
            // regains focus despite a real selection existing, and
            // Escape-without-selecting leaves stale leftover text ready to
            // reappear on the next focus.
            setQuery(selectedOption?.label ?? '');
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
                if (option) selectOption(option);
              }
            } else if (event.key === 'Escape') {
              setOpen(false);
            }
          }}
        />
      </PopoverAnchor>
      {/* Always mounted (unlike `PopoverContent`, which Radix mounts only
       * while open) — a live region's *first* content is typically not
       * announced by a screen reader, since there's no prior state for the
       * mutation observer to diff against. Living outside the popup means
       * it already exists in the DOM before the first result count is
       * ever set, so that first announcement isn't lost. */}
      <div aria-live="polite" className="sr-only">
        {open ? announceResults(filtered.length) : ''}
      </div>
      <PopoverContent
        className="w-(--radix-popover-trigger-width) p-1"
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        <div role="listbox" id={listboxId} aria-label={props['aria-label']}>
          {filtered.length === 0 && (
            <div className="px-2 py-1.5 text-sm text-muted-foreground">{emptyText}</div>
          )}
          {filtered.map((option, index) => (
            // Per the WAI-ARIA combobox pattern, an `option` is never itself
            // focused or a real keyboard target — focus stays on the input
            // the whole time, and every keyboard interaction (Arrow*, Enter,
            // Escape) is handled by that input's own onKeyDown above. A real
            // tabIndex/keydown here would let Tab stop on each option, which
            // the pattern explicitly does not want.
            // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/interactive-supports-focus
            <div
              key={option.value}
              id={optionId(index)}
              role="option"
              aria-selected={option.value === value}
              data-active={index === activeIndex}
              className="cursor-default rounded-md px-2 py-1.5 text-sm data-[active=true]:bg-accent"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => selectOption(option)}
            >
              {option.label}
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
