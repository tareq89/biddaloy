/**
 * Pick-many variant of `Combobox`: same WAI-ARIA wiring (focus stays on the
 * input, `aria-activedescendant`, always-mounted polite live region), but the
 * listbox is `aria-multiselectable`, Enter/click toggles and keeps the list
 * open, and the chosen values show as removable chips above the input.
 *
 * `options` may change under it (a server-side search): a chip keeps the label
 * it was last seen with. Pass `selectedOptions` for values that may never be in
 * `options` (a pre-filled edit form). `disabled`/`readOnly` freeze the value and
 * keep the list closed.
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
  /** Labels for chosen values that may not be in `options` (a pre-filled edit form). */
  selectedOptions?: MultiComboboxOption[] | undefined;
}

export function MultiCombobox({
  options,
  value,
  onValueChange,
  placeholder,
  emptyText,
  max,
  selectedOptions,
  onFocus,
  onKeyDown,
  ...props
}: MultiComboboxProps) {
  const { t } = useTranslation();
  placeholder ??= t('form.selectPlaceholder');
  emptyText ??= t('table.empty');
  const [openState, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [activeIndex, setActiveIndex] = React.useState(-1);
  // Last add/remove, for the live region; cleared as soon as the user types again.
  const [status, setStatus] = React.useState('');
  const listboxId = React.useId();
  const inputRef = React.useRef<HTMLInputElement>(null);
  // Set while `remove` hands focus back to the input, so that focus does not open the list.
  const skipOpen = React.useRef(false);
  // Idempotent render-time cache (a value always maps to its latest option), so a discarded
  // render cannot leave a wrong label. ponytail: grows with every option seen while mounted;
  // prune to `value` if a caller ever streams thousands of options.
  const known = React.useRef(new Map<string, MultiComboboxOption>());
  for (const option of [...(selectedOptions ?? []), ...options]) {
    known.current.set(option.value, option);
  }
  const locked = Boolean(props.disabled || props.readOnly);
  // A frozen value has nothing to pick, so its list never opens.
  const open = openState && !locked;

  const trimmed = toLatinDigits(query.trim().toLowerCase());
  const filtered =
    trimmed === ''
      ? options
      : options.filter((option) => toLatinDigits(option.label.toLowerCase()).includes(trimmed));
  const atMax = max !== undefined && value.length >= max;
  const chips = value.map((v) => known.current.get(v) ?? { value: v, label: v });
  const activeOption = open ? filtered[activeIndex] : undefined;

  function optionId(index: number): string {
    return `${listboxId}-option-${index}`;
  }

  function remove(optionValue: string) {
    if (locked) return;
    onValueChange(value.filter((v) => v !== optionValue));
    setStatus(
      t('multiCombobox.removed', { label: known.current.get(optionValue)?.label ?? optionValue }),
    );
    skipOpen.current = true;
    inputRef.current?.focus();
    skipOpen.current = false;
  }

  function close() {
    setOpen(false);
    setActiveIndex(-1); // a reopened list starts from the first option
  }

  function toggle(option: ComboboxOption) {
    if (locked) return;
    if (value.includes(option.value)) {
      onValueChange(value.filter((v) => v !== option.value));
      setStatus(t('multiCombobox.removed', { label: option.label }));
    } else if (!atMax) {
      onValueChange([...value, option.value]);
      setStatus(t('multiCombobox.added', { label: option.label }));
    } else {
      return;
    }
    setQuery('');
    setActiveIndex(0);
  }

  return (
    <Popover open={open} onOpenChange={(next) => (next ? setOpen(true) : close())}>
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
                  disabled={locked}
                  aria-label={t('multiCombobox.remove', { label: option.label })}
                  className="inline-flex size-11 items-center justify-center rounded-full text-text-secondary hover:text-text-primary disabled:hidden md:size-8"
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
            aria-activedescendant={activeOption ? optionId(activeIndex) : undefined}
            placeholder={placeholder}
            value={query}
            onFocus={(event) => {
              if (!skipOpen.current) setOpen(true);
              onFocus?.(event);
            }}
            onChange={(event) => {
              setQuery(event.target.value);
              setOpen(true);
              setActiveIndex(0);
              setStatus('');
            }}
            onKeyDown={(event) => {
              onKeyDown?.(event);
              // An IME uses Enter to confirm composed text; the caller may also claim the key.
              if (event.defaultPrevented || event.nativeEvent.isComposing) return;
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setOpen(true);
                setActiveIndex((index) => Math.min(index + 1, filtered.length - 1));
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                setActiveIndex((index) => Math.max(index - 1, 0));
              } else if (event.key === 'Enter') {
                // No matching option: leave Enter to the enclosing form.
                if (activeOption) {
                  event.preventDefault();
                  toggle(activeOption);
                }
              } else if (event.key === 'Backspace') {
                const last = value[value.length - 1];
                if (query === '' && last !== undefined) remove(last);
              } else if (event.key === 'Escape') {
                close();
              }
            }}
          />
        </PopoverAnchor>
      </div>
      <div aria-live="polite" className="sr-only">
        {status || (open ? t('combobox.results', { count: filtered.length }) : '')}
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
