/**
 * `?step=` as the source of truth for which wizard step is active —
 * survives refresh, same reasoning as `useDetailShellTab`'s `?tab=`. An
 * unknown or missing `?step=` value falls back to the first step.
 */
import { useSearchParams } from 'react-router';

export function useWizardShellStep(stepIds: readonly string[]): [string, (stepId: string) => void] {
  const [searchParams, setSearchParams] = useSearchParams();
  const firstStep = stepIds[0] ?? '';

  const raw = searchParams.get('step');
  const currentStepId = raw !== null && stepIds.includes(raw) ? raw : firstStep;

  function setStep(stepId: string): void {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('step', stepId);
      return next;
    });
  }

  return [currentStepId, setStep];
}
