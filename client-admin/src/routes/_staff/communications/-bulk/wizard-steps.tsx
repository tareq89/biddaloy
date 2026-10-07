import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatNumber } from '@biddaloy/ui/utils';
import { CheckIcon } from 'lucide-react';
import * as React from 'react';

export interface WizardStepsProps {
  labels: readonly string[];
  currentIndex: number;
  /** Only called for a done (earlier) step. */
  onStepClick: (index: number) => void;
}

/**
 * Numbered step row for a full-page wizard: current step filled, done steps
 * ticked and clickable, upcoming steps grey. Local to the bulk reminder
 * wizard — the shared `WizardShell` renders its own `h1` and footer, which
 * would double `FullPageShell`'s.
 */
export function WizardSteps({ labels, currentIndex, onStepClick }: WizardStepsProps) {
  const { t } = useTranslation('communications');
  const config = useRegionConfig();
  return (
    <ol
      aria-label={t('bulk.stepsLabel')}
      className="flex min-h-11 [scrollbar-width:none] items-center gap-2 overflow-x-auto"
    >
      {labels.map((label, index) => {
        const done = index < currentIndex;
        const current = index === currentIndex;
        return (
          <React.Fragment key={label}>
            {index > 0 && (
              <li aria-hidden className="h-px w-6 shrink-0 bg-border-functional md:w-12" />
            )}
            <li
              aria-current={current ? 'step' : undefined}
              className="flex shrink-0 items-center gap-2"
            >
              <span
                aria-hidden
                className={`flex size-7 shrink-0 items-center justify-center rounded-full text-label ${
                  current
                    ? 'bg-primary font-semibold text-primary-foreground'
                    : done
                      ? 'bg-secondary text-secondary-foreground'
                      : 'bg-muted text-text-secondary'
                }`}
              >
                {done ? <CheckIcon className="size-4" /> : formatNumber(index + 1, config)}
              </span>
              {done ? (
                <button
                  type="button"
                  className="inline-flex h-11 items-center font-medium text-primary md:h-8"
                  onClick={() => onStepClick(index)}
                >
                  {label}
                </button>
              ) : (
                <span className={current ? 'font-semibold' : 'text-text-secondary'}>{label}</span>
              )}
            </li>
          </React.Fragment>
        );
      })}
    </ol>
  );
}
