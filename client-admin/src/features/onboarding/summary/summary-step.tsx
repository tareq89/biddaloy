import { Card } from '@biddaloy/ui/components';
import { onboardingStatusQueryOptions, useUpdateOnboarding } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { useQuery } from '@tanstack/react-query';
import * as React from 'react';

import { WelcomeLink } from '../people/people-card';

const NEXT_STEPS = [
  { key: 'fees', to: '/fee-structures' },
  { key: 'guardians', to: '/guardians', search: { invite: 1 } },
  { key: 'messages', to: '/settings', search: { section: 'communication' } },
] as const;

/**
 * [13.6.4] Wizard step 3, the `done` slot. The frame only navigates away, so
 * reaching this step is what marks onboarding finished (once per mount).
 */
export function SummaryStep() {
  const { t } = useTranslation('onboardingPeople');
  const status = useQuery({ ...onboardingStatusQueryOptions(), refetchOnMount: 'always' });
  const { mutate, isError } = useUpdateOnboarding();
  const marked = React.useRef(false);
  React.useEffect(() => {
    if (marked.current) return;
    marked.current = true;
    mutate({ finished: true });
  }, [mutate]);

  const counts = status.data?.counts;
  const created = [
    t('summary.created.classes', { count: counts?.classes ?? 0 }),
    t('summary.created.sections', { count: counts?.sections ?? 0 }),
    t('summary.created.students', { count: counts?.students ?? 0 }),
    t('summary.created.staff', { count: counts?.staff ?? 0 }),
  ];

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-xl font-semibold">{t('summary.title')}</h2>
      {isError && (
        <p role="alert" className="text-sm text-destructive">
          {t('summary.saveError')}
        </p>
      )}
      <Card padded>
        <ul className="grid grid-cols-2 gap-3">
          {created.map((line) => (
            <li key={line} className="text-base font-medium">
              {line}
            </li>
          ))}
        </ul>
      </Card>
      <section aria-labelledby="onboarding-next" className="flex flex-col gap-2">
        <h3 id="onboarding-next" className="text-base font-semibold">
          {t('summary.next.title')}
        </h3>
        <ul className="flex flex-col gap-2">
          {NEXT_STEPS.map((s) => (
            <li key={s.key}>
              <WelcomeLink
                to={s.to}
                search={'search' in s ? s.search : undefined}
                className="block rounded-md border border-border px-4 py-3 text-sm font-medium hover:bg-muted"
              >
                {t(`summary.next.${s.key}`)}
              </WelcomeLink>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
