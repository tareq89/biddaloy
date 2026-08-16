/**
 * `?step=` as the source of truth for which wizard step is active —
 * survives refresh, same reasoning as `useDetailShellTab`'s `?tab=`. An
 * unknown or missing `?step=` value falls back to the first step.
 * `setStep` rejects a step id that isn't in `stepIds` rather than writing
 * it to the URL and relying on the same fallback to paper over it on
 * next read — the visible step and the URL should never disagree, even
 * for one render.
 */
import { useSearch } from '@tanstack/react-router';

import { useSearchNavigate } from '../routes/navigate-search';

export function useWizardShellStep(stepIds: readonly string[]): [string, (stepId: string) => void] {
  // `strict: false` — this hook has no fixed route id, same reasoning as
  // `useListUrlState` (see its own comment).
  const search = useSearch({ strict: false }) as unknown as Record<string, unknown>;
  const navigateSearch = useSearchNavigate();
  const firstStep = stepIds[0] ?? '';

  const raw = search.step;
  const currentStepId = typeof raw === 'string' && stepIds.includes(raw) ? raw : firstStep;

  function setStep(stepId: string): void {
    if (!stepIds.includes(stepId)) return;
    navigateSearch((prev) => ({ ...prev, step: stepId }));
  }

  return [currentStepId, setStep];
}
