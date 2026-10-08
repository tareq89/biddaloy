/**
 * [13.4.3] The small "1 · 2 · 3" indicator for a card that is not a
 * `WizardShell` (the register card). On phone it collapses to
 * `progressLabel` ("Step 2 of 3") plus the active step's label; the caller
 * supplies that string so copy stays with the screen.
 */
import { CheckIcon } from 'lucide-react';
import * as React from 'react';

import { useTranslation } from '../i18n';
import { cn } from '../primitives/lib/utils';

export interface StepIndicatorProps {
  steps: readonly { id: string; label: string }[];
  /** `id` of the active step. */
  current: string;
  /** Phone text, e.g. "Step 2 of 3". */
  progressLabel: string;
  className?: string;
}

export function StepIndicator({ steps, current, progressLabel, className }: StepIndicatorProps) {
  const { t } = useTranslation('common');
  const active = steps.find((s) => s.id === current);
  const currentIndex = steps.findIndex((s) => s.id === current);
  return (
    <div className={className}>
      <p className="text-sm font-medium sm:hidden">
        {progressLabel}
        {active && <span className="text-muted-foreground"> · {active.label}</span>}
      </p>
      <ol className="hidden items-center gap-2 sm:flex">
        {steps.map((step, i) => (
          <React.Fragment key={step.id}>
            {i > 0 && <li aria-hidden="true" className="h-px w-6 bg-border-subtle" />}
            <li
              aria-current={step.id === current ? 'step' : undefined}
              className={cn(
                'flex items-center gap-2 text-sm',
                step.id === current ? 'font-medium text-foreground' : 'text-muted-foreground',
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  'flex size-6 items-center justify-center rounded-full border text-xs',
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
          </React.Fragment>
        ))}
      </ol>
    </div>
  );
}
