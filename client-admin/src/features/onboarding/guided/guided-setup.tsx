/**
 * [13.5.4] The "answer a few questions" path inside the welcome wizard's setup
 * slot: school -> curriculum -> sections. The question is kept in `&q=1|2|3` so
 * a reload resumes at the same place. Each step saves through its own existing
 * API; the wizard frame owns only its own footer, so the steps carry their own
 * Back / Next.
 */
import { useSearchNavigate } from '@biddaloy/ui/routes';
import { useSearch } from '@tanstack/react-router';

import { useOnboardingStep } from '../use-onboarding-step';

import { CurriculumStep } from './curriculum-step';
import { ProfileStep } from './profile-step';
import { SectionsStep } from './sections-step';

export function GuidedSetup() {
  const search = useSearch({ strict: false }) as unknown as Record<string, unknown>;
  const navigateSearch = useSearchNavigate();
  const { setStep, setPath } = useOnboardingStep();
  // The router JSON-parses the query string, so `q=3` arrives as the number 3.
  const q = Number(search.q) === 2 || Number(search.q) === 3 ? Number(search.q) : 1;
  const go = (next: number) => navigateSearch((prev) => ({ ...prev, q: next }));

  if (q === 2) return <CurriculumStep onBack={() => go(1)} onNext={() => go(3)} />;
  if (q === 3) return <SectionsStep onBack={() => go(2)} onDone={() => setStep('people')} />;
  return <ProfileStep onBack={() => setPath(null)} onNext={() => go(2)} />;
}
