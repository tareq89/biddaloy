/**
 * [28.3.2] One staff member's ACR — `/staff/$userId/acr/$assessmentId`.
 *
 * The page owns fetching and `document.title`; `AcrForm` owns the form.
 * `seed` is the assessment the form was built from: set once from the first
 * fetch (later cache writes from autosave PATCHes and refetches are
 * ignored on purpose — see `AcrForm`'s header) and replaced only by the
 * server's answer to Complete / Reopen.
 */
import { ErrorState, RoutePending, Skeleton } from '@biddaloy/ui/components';
import {
  useAcademicYear,
  useAcrAssessment,
  useAcrCriteria,
  useUser,
  type AcrAssessment,
} from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { createFileRoute } from '@tanstack/react-router';
import * as React from 'react';

import { loadRouteNamespaces } from '../../../route-loaders';

import { AcrForm } from './-acr/acr-form';

export const Route = createFileRoute('/_staff/staff/$userId_/acr/$assessmentId')({
  loader: () => loadRouteNamespaces('evaluations', 'staff', 'common'),
  pendingComponent: AcrPending,
  component: AcrPage,
});

function AcrPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="detail" label={t('routePending.label', { ns: 'nav' })} />;
}

function AcrPage() {
  const { userId, assessmentId } = Route.useParams();
  const { t } = useTranslation('evaluations');
  const assessmentQuery = useAcrAssessment(assessmentId);
  const criteriaQuery = useAcrCriteria();
  const userQuery = useUser(userId);
  const [seed, setSeed] = React.useState<AcrAssessment | undefined>(undefined);
  if (assessmentQuery.data && seed === undefined) setSeed(assessmentQuery.data);
  const yearQuery = useAcademicYear(seed?.academic_year_id);

  const name = userQuery.data?.full_name ?? '';
  const year = yearQuery.data?.name ?? '';
  const titleReady = name !== '' && year !== '';
  const title = t('acr.documentTitle', { name, year });
  React.useEffect(() => {
    if (!titleReady) return;
    // `_staff.tsx` owns `document.title` from the breadcrumb trail and
    // re-applies it in its own (later-running) effect; defer past it.
    const timer = setTimeout(() => {
      document.title = title;
    }, 0);
    return () => clearTimeout(timer);
  }, [titleReady, title]);

  if (assessmentQuery.isError || criteriaQuery.isError) {
    return (
      <ErrorState
        message={t('acr.loadError')}
        onRetry={() => {
          void assessmentQuery.refetch();
          void criteriaQuery.refetch();
        }}
      />
    );
  }
  // A URL whose user does not match the assessment's is not this ACR.
  if (seed && seed.user_id !== userId) {
    return (
      <ErrorState message={t('acr.loadError')} onRetry={() => void assessmentQuery.refetch()} />
    );
  }
  if (!seed || !criteriaQuery.data) {
    return <Skeleton className="h-64 w-full" />;
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">{title}</p>
      <AcrForm
        key={`${seed.status}:${seed.completed_at ?? ''}`}
        assessment={seed}
        criteria={criteriaQuery.data.criteria}
        onServerUpdate={setSeed}
      />
    </div>
  );
}
