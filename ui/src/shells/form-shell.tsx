/**
 * Single column, `<fieldset>`/`<legend>` grouping (`FormSection`), and the
 * error-summary pattern: on submit failure, a summary lists every problem
 * as a link that moves focus to the offending field, and focus moves to
 * the summary itself. That matters most for a long form (student
 * admission has enough fields that a user who submits and sees nothing
 * change above the fold has no way to find the one invalid field below
 * it) — the summary is the thing that makes the failure visible at all.
 *
 * Focus only moves to the summary on an actual submit *attempt* transition
 * (`submitCount` changing — pass `form.formState.submitCount`), not on
 * every re-render while errors happen to still be present. Otherwise
 * clicking a summary link (which itself moves focus to a field) would
 * immediately get its focus yanked back to the summary by the next
 * render — fighting the very interaction the summary exists to enable.
 */
import * as React from 'react';

export interface FormShellError {
  /** Must match the target field's `id` — used both for the summary
   * link's `href="#id"` fallback and for `document.getElementById(id)
   * .focus()`, which is what actually moves focus (a `#hash` link alone
   * scrolls but doesn't reliably focus form controls across browsers). */
  field: string;
  message: string;
}

export interface FormShellProps {
  title?: string;
  errors: FormShellError[];
  /** `form.formState.submitCount` from react-hook-form — the trigger for
   * "focus moves to the summary on submit failure", distinct from the
   * error list itself changing. */
  submitCount: number;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  children: React.ReactNode;
}

export function FormShell({ title, errors, submitCount, onSubmit, children }: FormShellProps) {
  const summaryRef = React.useRef<HTMLDivElement>(null);
  const lastSubmitCount = React.useRef(submitCount);

  React.useEffect(() => {
    if (errors.length > 0 && submitCount !== lastSubmitCount.current) {
      summaryRef.current?.focus();
    }
    lastSubmitCount.current = submitCount;
  }, [errors.length, submitCount]);

  return (
    <form onSubmit={onSubmit} noValidate className="flex max-w-xl flex-col gap-6">
      {title && <h1 className="text-lg font-semibold">{title}</h1>}
      {errors.length > 0 && (
        <div
          ref={summaryRef}
          tabIndex={-1}
          role="alert"
          aria-labelledby="form-shell-error-summary-heading"
          className="rounded-lg border border-destructive/50 bg-destructive/5 p-4 focus:outline-none"
        >
          <p id="form-shell-error-summary-heading" className="font-medium text-destructive">
            {errors.length === 1 ? 'There is 1 problem' : `There are ${errors.length} problems`}{' '}
            with your submission
          </p>
          <ul className="mt-2 list-disc pl-5">
            {errors.map((error) => (
              <li key={error.field}>
                <a
                  href={`#${error.field}`}
                  className="text-destructive underline underline-offset-2"
                  onClick={(event) => {
                    event.preventDefault();
                    document.getElementById(error.field)?.focus();
                  }}
                >
                  {error.message}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
      {children}
    </form>
  );
}

export interface FormSectionProps {
  legend: string;
  children: React.ReactNode;
}

/** `<fieldset>`/`<legend>` grouping — the issue's own layout requirement.
 * A native `<fieldset>` gives every contained control's accessible name a
 * "within {legend}" context for free, no `aria-*` wiring needed. */
export function FormSection({ legend, children }: FormSectionProps) {
  return (
    <fieldset className="flex flex-col gap-4 rounded-lg border border-border p-4">
      <legend className="px-1 text-sm font-medium">{legend}</legend>
      {children}
    </fieldset>
  );
}
