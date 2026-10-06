/**
 * [13.6.1] One-column radio group of cards. One tab stop (the selected card);
 * arrow keys move and select, Space selects, Enter runs `onEnter` (= "Next").
 */
import * as React from 'react';

export interface ChoiceOption<V extends string> {
  value: V;
  title: string;
  body: string;
  /** Small "Recommended" pill next to the title. */
  badge?: string;
}

export interface ChoiceCardGroupProps<V extends string> {
  label: string;
  options: readonly ChoiceOption<V>[];
  value: V;
  onChange: (value: V) => void;
  onEnter?: () => void;
}

export function ChoiceCardGroup<V extends string>({
  label,
  options,
  value,
  onChange,
  onEnter,
}: ChoiceCardGroupProps<V>) {
  const refs = React.useRef<(HTMLButtonElement | null)[]>([]);

  function move(from: number, delta: number) {
    const next = options[(from + delta + options.length) % options.length];
    if (!next) return;
    onChange(next.value);
    refs.current[options.indexOf(next)]?.focus();
  }

  function onKeyDown(event: React.KeyboardEvent, index: number) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') move(index, 1);
    else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') move(index, -1);
    else if (event.key === 'Enter' && onEnter) onEnter();
    else return;
    event.preventDefault();
  }

  return (
    <div role="radiogroup" aria-label={label} className="flex flex-col gap-3">
      {options.map((option, index) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            ref={(el) => {
              refs.current[index] = el;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={`flex min-h-11 w-full items-start gap-3 rounded-lg border bg-surface p-4 text-start outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              selected ? 'border-primary' : 'border-border-subtle hover:border-border'
            }`}
          >
            <span
              aria-hidden="true"
              className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border ${
                selected ? 'border-primary' : 'border-border'
              }`}
            >
              {selected && <span className="size-2.5 rounded-full bg-primary" />}
            </span>
            <span className="flex flex-col gap-1">
              <span className="flex flex-wrap items-center gap-2 font-medium">
                {option.title}
                {option.badge && (
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                    {option.badge}
                  </span>
                )}
              </span>
              <span className="text-sm text-muted-foreground">{option.body}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
