/**
 * [99.W0] Searchable list of people for one role. The parent searches on the
 * server (`onSearchChange`); this component never filters. A row with
 * `disabledReason` cannot be chosen and shows the reason as text. ARIA
 * combobox pattern: focus stays in the search box, arrows move the active row
 * (skipping disabled ones), Enter picks it. Labels are props — no `useTranslation`.
 */
import { CheckIcon } from 'lucide-react';
import * as React from 'react';

import { cn } from '../primitives/lib/utils';

import { Input } from './input';

export interface PersonPickerItem {
  id: string;
  name: string;
  meta: string;
  disabledReason?: string;
}

export interface PersonPickerProps {
  items: readonly PersonPickerItem[];
  value: string | undefined;
  onValueChange: (id: string) => void;
  /** Accessible name of the search box. */
  searchLabel: string;
  onSearchChange: (query: string) => void;
  emptyLabel: string;
  /** Accessible name of the list. */
  label: string;
  className?: string;
}

export function PersonPicker({
  items,
  value,
  onValueChange,
  searchLabel,
  onSearchChange,
  emptyLabel,
  label,
  className,
}: PersonPickerProps) {
  const uid = React.useId();
  const [activeId, setActiveId] = React.useState<string | undefined>();
  // Track the active row by person id: a replaced result set drops it instead of re-pointing it.
  const active = activeId ? items.findIndex((it) => it.id === activeId) : -1;
  const setActive = (i: number) => setActiveId(items[i]?.id);
  const enabled = (i: number) => items[i] !== undefined && !items[i].disabledReason;
  const move = (dir: 1 | -1) => {
    for (let i = active + dir; i >= 0 && i < items.length; i += dir) {
      if (enabled(i)) {
        setActive(i);
        return;
      }
    }
  };
  const optionId = (i: number) => `${uid}-${i}`;
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <Input
        type="search"
        role="combobox"
        aria-label={searchLabel}
        aria-expanded={items.length > 0}
        aria-controls={items.length > 0 ? `${uid}-list` : undefined}
        aria-activedescendant={active >= 0 && items[active] ? optionId(active) : undefined}
        onChange={(e) => {
          setActive(-1);
          onSearchChange(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            move(1);
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            move(-1);
          } else if (e.key === 'Enter' && enabled(active)) {
            e.preventDefault();
            onValueChange(items[active]!.id);
          }
        }}
      />
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyLabel}</p>
      ) : (
        <ul id={`${uid}-list`} role="listbox" aria-label={label} className="flex flex-col gap-1">
          {items.map((item, i) => {
            const selected = item.id === value;
            return (
              // Keyboard use goes through the search box (arrows + Enter), per the combobox pattern.
              // eslint-disable-next-line jsx-a11y/click-events-have-key-events
              <li
                key={item.id}
                id={optionId(i)}
                role="option"
                aria-selected={selected}
                aria-disabled={item.disabledReason ? true : undefined}
                onClick={() => !item.disabledReason && onValueChange(item.id)}
                className={cn(
                  'flex min-h-11 items-center gap-3 rounded-lg border px-3 py-1.5',
                  selected ? 'border-primary bg-secondary' : 'border-border-subtle bg-surface',
                  item.disabledReason
                    ? 'cursor-not-allowed opacity-70'
                    : 'cursor-pointer hover:bg-muted',
                  i === active && 'ring-2 ring-ring',
                )}
              >
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate font-semibold">{item.name}</span>
                  <span className="truncate text-sm text-muted-foreground">{item.meta}</span>
                  {item.disabledReason && (
                    <span className="text-sm text-muted-foreground">{item.disabledReason}</span>
                  )}
                </span>
                {selected && <CheckIcon aria-hidden="true" className="size-4 shrink-0" />}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
