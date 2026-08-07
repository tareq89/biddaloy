/**
 * For genuinely multi-stage, irreversible-or-expensive-to-undo work:
 * Record Payment, Generate Fees, Bulk Import, Bulk Reminders. The
 * review-before-submit requirement is enforced **by types**, not
 * documentation: `WizardShellProps` is a discriminated union on
 * `irreversible` — set it `true` without also supplying `reviewStep` and
 * the file doesn't compile. A comment saying "don't forget the review
 * step" gets forgotten under delivery pressure; a type error can't be.
 *
 * Steps stay mounted once visited (same lazy-then-cached pattern
 * `DetailShell` uses for its tab panels) — that's what makes "Back
 * preserves previously entered data" true without this component needing
 * to own any of that data itself: a step's own uncontrolled inputs/local
 * state survive because the step's component instance never unmounts,
 * it's only hidden.
 */
import * as React from 'react';

import { Button } from '../components/button';

export interface WizardStep {
  id: string;
  label: string;
  content: React.ReactNode;
  /** Must return `true` before "Next" is enabled. Omit for a purely
   * informational step that's always valid. */
  isValid?: () => boolean;
}

interface WizardShellBaseProps {
  title: string;
  steps: WizardStep[];
  currentStepId: string;
  onStepChange: (stepId: string) => void;
  onSubmit: () => void;
  submitLabel?: string;
  submitting?: boolean;
  /** Replaces the entire step flow with a result screen once submission
   * completes — counts with plain-language explanations, per the issue's
   * own acceptance criterion, are the caller's content, not a fixed shape
   * this component could impose. */
  result?: React.ReactNode;
}

export type WizardShellProps =
  | (WizardShellBaseProps & { irreversible: true; reviewStep: WizardStep })
  | (WizardShellBaseProps & { irreversible?: false; reviewStep?: WizardStep });

export function WizardShell({
  title,
  steps,
  currentStepId,
  onStepChange,
  onSubmit,
  submitLabel = 'Submit',
  submitting = false,
  result,
  reviewStep,
}: WizardShellProps) {
  const allSteps = reviewStep ? [...steps, reviewStep] : steps;
  const currentIndex = Math.max(
    0,
    allSteps.findIndex((step) => step.id === currentStepId),
  );
  const currentStep = allSteps[currentIndex];
  const isLastStep = currentIndex === allSteps.length - 1;
  const isValid = currentStep?.isValid ? currentStep.isValid() : true;

  const [visitedSteps, setVisitedSteps] = React.useState<ReadonlySet<string>>(
    () => new Set([currentStepId]),
  );

  React.useEffect(() => {
    if (!visitedSteps.has(currentStepId)) {
      setVisitedSteps((prev) => new Set(prev).add(currentStepId));
    }
  }, [currentStepId, visitedSteps]);

  function goNext() {
    if (!isValid || isLastStep) return;
    const nextStep = allSteps[currentIndex + 1];
    if (nextStep) onStepChange(nextStep.id);
  }

  function goBack() {
    const prevStep = allSteps[currentIndex - 1];
    if (prevStep) onStepChange(prevStep.id);
  }

  if (result) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-lg font-semibold">{title}</h1>
        {result}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold">{title}</h1>

      <ol className="flex flex-wrap items-center gap-2 text-sm">
        {allSteps.map((step, index) => {
          const isCurrent = step.id === currentStepId;
          const isCompleted = index < currentIndex;
          return (
            <li key={step.id} aria-current={isCurrent ? 'step' : undefined}>
              {isCompleted ? (
                <button
                  type="button"
                  className="text-primary underline-offset-2 hover:underline"
                  onClick={() => onStepChange(step.id)}
                >
                  {step.label}
                </button>
              ) : (
                <span
                  className={isCurrent ? 'font-medium text-foreground' : 'text-muted-foreground'}
                >
                  {step.label}
                </span>
              )}
              {index < allSteps.length - 1 && (
                <span aria-hidden="true" className="ml-2 text-muted-foreground">
                  ›
                </span>
              )}
            </li>
          );
        })}
      </ol>
      <div aria-live="polite" className="sr-only">
        Step {currentIndex + 1} of {allSteps.length}: {currentStep?.label}
      </div>

      {allSteps.map((step) => {
        const visited = visitedSteps.has(step.id);
        return (
          <div key={step.id} hidden={step.id !== currentStepId}>
            {visited ? step.content : null}
          </div>
        );
      })}

      <div className="flex justify-between gap-2">
        <Button type="button" variant="outline" onClick={goBack} disabled={currentIndex === 0}>
          Back
        </Button>
        {isLastStep ? (
          <Button type="button" loading={submitting} onClick={onSubmit} disabled={!isValid}>
            {submitLabel}
          </Button>
        ) : (
          <Button type="button" onClick={goNext} disabled={!isValid}>
            Next
          </Button>
        )}
      </div>
    </div>
  );
}
