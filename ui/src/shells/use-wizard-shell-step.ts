/**
 * `?step=` as the source of truth for which wizard step is active —
 * survives refresh, same reasoning as `useDetailShellTab`'s `?tab=`. An
 * unknown or missing `?step=` value falls back to the first step.
 * `setStep` rejects a step id that isn't in `stepIds` rather than writing
 * it to the URL and relying on the same fallback to paper over it on
 * next read — the visible step and the URL should never disagree, even
 * for one render.
 */
import { useSearchParams } from 'react-router';

export function useWizardShellStep(stepIds: readonly string[]): [string, (stepId: string) => void] {
  const [searchParams, setSearchParams] = useSearchParams();
  const firstStep = stepIds[0] ?? '';

  const raw = searchParams.get('step');
  const currentStepId = raw !== null && stepIds.includes(raw) ? raw : firstStep;

  function setStep(stepId: string): void {
    if (!stepIds.includes(stepId)) return;
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('step', stepId);
      return next;
    });
  }

  return [currentStepId, setStep];
}
