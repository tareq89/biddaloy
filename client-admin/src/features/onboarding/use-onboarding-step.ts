/**
 * [13.6.1] Where the welcome wizard is, kept in the URL so a reload resumes
 * the same place: `?step=setup|people|done`, plus `&path=guided|excel` while
 * inside the setup step.
 */
import { useSearchNavigate } from '@biddaloy/ui/routes';
import { useWizardShellStep } from '@biddaloy/ui/shells';
import { useSearch } from '@tanstack/react-router';

export const ONBOARDING_STEPS = ['setup', 'people', 'done'] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];
export type OnboardingSlotPath = 'guided' | 'excel';

/** Drops the setup slot's own state: the path and the guided question `q`. */
function withoutPath(search: Record<string, unknown>) {
  const rest = { ...search };
  delete rest.path;
  delete rest.q;
  return rest;
}

export function useOnboardingStep() {
  // Unknown / missing `?step=` already falls back to the first step ('setup').
  const [step] = useWizardShellStep(ONBOARDING_STEPS);
  // `strict: false` — no fixed route id; the /welcome route arrives in a later ticket.
  const search = useSearch({ strict: false }) as unknown as Record<string, unknown>;
  const navigateSearch = useSearchNavigate();
  const path: OnboardingSlotPath | null =
    step === 'setup' && (search.path === 'guided' || search.path === 'excel') ? search.path : null;

  return {
    step: step as OnboardingStep,
    path,
    /** Moving to a step always leaves any `path` (and guided `q`) behind. */
    setStep: (next: OnboardingStep) =>
      navigateSearch((prev) => ({ ...withoutPath(prev), step: next })),
    /** `null` goes back to the three doors. */
    setPath: (next: OnboardingSlotPath | null) =>
      navigateSearch((prev) => ({
        ...withoutPath(prev),
        step: 'setup',
        ...(next ? { path: next } : {}),
      })),
  };
}
