import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@biddaloy/ui/components';
import * as React from 'react';

/** Join the truthy class names. */
const cn = (...c: (string | false)[]) => c.filter(Boolean).join(' ');

export interface DeskStep {
  id: string;
  label: string;
}
export interface DeskStepperProps {
  steps: readonly DeskStep[];
  /** The step whose panel is open. */
  selected: string;
  /** The step with work left; marked with a dot. */
  next: string;
  onSelect: (id: string) => void;
  label: string;
  /** Phone text, e.g. "Step 2 of 5". */
  progressLabel: string;
  pickLabel: string;
}

/** Clickable stage stepper; arrow keys / Home / End move between steps (#2204 D11).
 * From `sm` up: a row of numbered buttons. Phone: a progress bar and one select. */
export function DeskStepper({
  steps,
  selected,
  next,
  onSelect,
  label,
  progressLabel,
  pickLabel,
}: DeskStepperProps) {
  const refs = React.useRef<(HTMLButtonElement | null)[]>([]);
  const index = Math.max(
    0,
    steps.findIndex((s) => s.id === selected),
  );
  const move = (e: React.KeyboardEvent, from: number) => {
    const last = steps.length - 1;
    const to =
      e.key === 'ArrowRight' || e.key === 'ArrowDown'
        ? Math.min(from + 1, last)
        : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
          ? Math.max(from - 1, 0)
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? last
              : -1;
    if (to < 0) return;
    e.preventDefault();
    onSelect(steps[to]!.id);
    refs.current[to]?.focus();
  };
  return (
    <nav aria-label={label}>
      <div className="flex flex-col gap-2 sm:hidden">
        <p className="text-label text-text-secondary">{progressLabel}</p>
        <div aria-hidden="true" className="flex gap-1">
          {steps.map((s, i) => (
            <span
              key={s.id}
              className={cn('h-1 flex-1 rounded-full', i <= index ? 'bg-primary' : 'bg-muted')}
            />
          ))}
        </div>
        <Select value={selected} onValueChange={onSelect}>
          <SelectTrigger aria-label={pickLabel} className="min-h-11">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {steps.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.label}
                {s.id === next ? ' •' : ''}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <ol className="hidden flex-wrap items-center gap-2 sm:flex">
        {steps.map((s, i) => (
          <li key={s.id} className="flex items-center gap-2">
            {i > 0 && <span aria-hidden="true" className="h-px w-6 bg-border-subtle" />}
            <button
              type="button"
              ref={(el) => {
                refs.current[i] = el;
              }}
              tabIndex={i === index ? 0 : -1}
              aria-current={s.id === selected ? 'step' : undefined}
              data-next={s.id === next}
              onClick={() => onSelect(s.id)}
              onKeyDown={(e) => move(e, i)}
              className={cn(
                'flex items-center gap-2 rounded-md px-2 py-1 text-sm focus-visible:outline focus-visible:outline-2',
                s.id === selected
                  ? 'bg-muted font-medium text-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  'flex size-7 items-center justify-center rounded-full border text-xs',
                  s.id === next
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border-subtle',
                )}
              >
                {i + 1}
              </span>
              {s.label}
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}
