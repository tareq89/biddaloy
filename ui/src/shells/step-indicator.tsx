/**
 * The "Step 1 › Step 2 › Step 3" row, lifted out of `WizardShell` so a
 * `FullPageShell` (which brings its own header) can show steps too.
 * Only completed steps are buttons; the current one carries
 * `aria-current="step"`.
 */
export interface StepIndicatorProps {
  steps: readonly { id: string; label: string }[];
  currentStepId: string;
  /** Omit to make every step plain text (no jumping back). */
  onStepChange?: (id: string) => void;
  /** Accessible name, e.g. "ধাপ". When given, the list is wrapped in `<nav aria-label>`. */
  label?: string;
}

export function StepIndicator({ steps, currentStepId, onStepChange, label }: StepIndicatorProps) {
  const currentIndex = Math.max(
    0,
    steps.findIndex((step) => step.id === currentStepId),
  );
  const list = (
    <ol className="flex flex-wrap items-center gap-2 text-sm">
      {steps.map((step, index) => {
        const isCurrent = step.id === currentStepId;
        // Recomputed from the *current* position every render, not
        // "ever visited" — jumping back to an earlier step un-completes
        // everything after it, so a later step can't be clicked back
        // into without going through its own validation again.
        const isCompleted = index < currentIndex;
        return (
          <li key={step.id} aria-current={isCurrent ? 'step' : undefined}>
            {isCompleted && onStepChange ? (
              <button
                type="button"
                className="text-primary underline-offset-2 hover:underline"
                onClick={() => onStepChange(step.id)}
              >
                {step.label}
              </button>
            ) : (
              <span className={isCurrent ? 'font-medium text-foreground' : 'text-muted-foreground'}>
                {step.label}
              </span>
            )}
            {index < steps.length - 1 && (
              <span aria-hidden="true" className="ms-2 text-muted-foreground">
                ›
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
  return label ? <nav aria-label={label}>{list}</nav> : list;
}
