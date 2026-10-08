/**
 * [13.4.3, 66.1.06] `Stepper` — the "1 · 2 · 3" indicator for a card that is
 * not a `WizardShell`. On phone: `progressLabel` ("ধাপ ২/৪"), the active
 * step's label and one bar segment per step. From `sm` up: numbered circles.
 * The caller supplies the strings so copy stays with the screen.
 */
import { CheckIcon } from 'lucide-react';

import { useTranslation } from '../i18n';
import { cn } from '../primitives/lib/utils';

export interface StepperProps {
  steps: readonly { id: string; label: string }[];
  /** `id` of the active step. */
  current: string;
  /** Phone text, e.g. "Step 2 of 3". */
  progressLabel: string;
  /** Accessible name of the `<nav>`, e.g. "ধাপ". */
  label?: string;
  className?: string;
}

export function Stepper({ steps, current, progressLabel, label, className }: StepperProps) {
  const { t } = useTranslation('common');
  const active = steps.find((s) => s.id === current);
  const currentIndex = steps.findIndex((s) => s.id === current);
  return (
    <nav aria-label={label} className={className}>
      <div className="flex flex-col gap-2 sm:hidden">
        <p className="text-label text-text-secondary">{progressLabel}</p>
        {active && <p className="text-h3 text-text-primary">{active.label}</p>}
        <div aria-hidden="true" className="flex gap-1">
          {steps.map((step, i) => (
            <span
              key={step.id}
              className={cn(
                'h-1 flex-1 rounded-full',
                i <= currentIndex ? 'bg-primary' : 'bg-muted',
              )}
            />
          ))}
        </div>
      </div>
      <ol className="hidden items-center gap-2 sm:flex">
        {steps.map((step, i) => (
          <li
            key={step.id}
            aria-current={step.id === current ? 'step' : undefined}
            className={cn(
              'flex items-center gap-2 text-sm',
              step.id === current ? 'font-medium text-foreground' : 'text-muted-foreground',
            )}
          >
            {/* Connector from the previous step: decorative, inside the item so
                the list still counts only real steps. */}
            {i > 0 && <span aria-hidden="true" className="h-px w-6 bg-border-subtle" />}
            <span
              aria-hidden="true"
              className={cn(
                'flex size-7 items-center justify-center rounded-full border text-xs',
                step.id === current
                  ? 'border-primary bg-primary text-primary-foreground'
                  : i < currentIndex
                    ? 'border-primary text-primary'
                    : 'border-border-subtle',
              )}
            >
              {i < currentIndex ? <CheckIcon className="size-3.5" /> : i + 1}
            </span>
            {step.label}
            {/* The tick above is decorative; this is what a screen reader hears. */}
            {i < currentIndex && <span className="sr-only"> {t('stepIndicator.done')}</span>}
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** Kept so the register card and wizards that import the old name do not change. */
export const StepIndicator = Stepper;
export type StepIndicatorProps = StepperProps;
