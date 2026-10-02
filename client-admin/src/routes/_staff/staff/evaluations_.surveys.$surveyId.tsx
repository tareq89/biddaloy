/**
 * [28.4.2] One survey — `/staff/evaluations/surveys/$surveyId`. The file name's
 * `evaluations_` opts out of nesting under `evaluations.tsx` (which has no
 * `<Outlet />`), same escape as `$userId_.acr.$assessmentId.tsx`.
 * Gated on `ACR_READ` (`route-permissions.ts`); publish/close need `ACR_WRITE`.
 */
import { Permission } from '@biddaloy/shared';
import { ErrorState, RoutePending, Skeleton, toast } from '@biddaloy/ui/components';
import { useCloseSurvey, useHasPermission, usePublishSurvey, useSurvey } from '@biddaloy/ui/hooks';
import { useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { DetailShell } from '@biddaloy/ui/shells';
import { formatDate } from '@biddaloy/ui/utils';
import { createFileRoute } from '@tanstack/react-router';
import * as React from 'react';

import { loadRouteNamespaces } from '../../../route-loaders';

import { SurveyResults } from './-evaluations/survey-results';

export const Route = createFileRoute('/_staff/staff/evaluations_/surveys/$surveyId')({
  loader: () => loadRouteNamespaces('evaluations', 'staff', 'common'),
  pendingComponent: SurveyPending,
  component: SurveyPage,
});

function SurveyPage() {
  const { surveyId } = Route.useParams();
  const { t } = useTranslation('evaluations');
  const regionConfig = useTenantRegionConfig();
  const canWrite = useHasPermission(Permission.ACR_WRITE);
  const query = useSurvey(surveyId);
  const publish = usePublishSurvey();
  const close = useCloseSurvey();
  const survey = query.data;

  const title = survey ? t('surveys.detail.documentTitle', { title: survey.title }) : '';
  React.useEffect(() => {
    if (!title) return;
    // `_staff.tsx` owns `document.title`; defer past its own effect.
    const timer = setTimeout(() => {
      document.title = title;
    }, 0);
    return () => clearTimeout(timer);
  }, [title]);

  if (query.isError) {
    return (
      <ErrorState message={t('surveys.detail.loadError')} onRetry={() => void query.refetch()} />
    );
  }
  if (!survey) return <Skeleton className="h-64 w-full" />;

  const date = (iso: string | null) =>
    iso ? formatDate(new Date(iso), regionConfig) : t('surveys.detail.noDate');

  return (
    <div className="flex flex-col gap-3">
      <DetailShell
        name={survey.title}
        statusBadge={
          <span className="rounded-full border px-2 py-0.5 text-xs">
            {t(`surveys.status.${survey.status}`)}
          </span>
        }
        identifiers={
          <p className="text-sm text-muted-foreground">
            {t(survey.anonymous ? 'surveys.detail.anonymousOn' : 'surveys.detail.anonymousOff')} ·{' '}
            {t('surveys.detail.opensAt')} {date(survey.opens_at)} · {t('surveys.detail.closesAt')}{' '}
            {date(survey.closes_at)}
          </p>
        }
        actions={[
          {
            id: 'publish',
            label: publish.isPending ? t('surveys.detail.publishing') : t('surveys.detail.publish'),
            priority: 'primary',
            allowed: canWrite && survey.status === 'DRAFT' && !publish.isPending,
            onClick: () =>
              publish.mutate(survey.id, {
                onSuccess: () => toast.success(t('surveys.form.published')),
              }),
          },
          {
            id: 'close',
            label: close.isPending ? t('surveys.detail.closing') : t('surveys.detail.close'),
            priority: 'secondary',
            allowed: canWrite && survey.status === 'OPEN' && !close.isPending,
            onClick: () => close.mutate(survey.id),
          },
        ]}
        tabs={[
          {
            id: 'results',
            label: t('surveys.detail.resultsTitle'),
            content: <SurveyResults surveyId={survey.id} status={survey.status} />,
          },
        ]}
        activeTab="results"
        onTabChange={() => undefined}
      />
      {publish.isError && (
        <p role="alert" className="text-sm text-destructive">
          {t('surveys.detail.publishError')}
        </p>
      )}
      {close.isError && (
        <p role="alert" className="text-sm text-destructive">
          {t('surveys.detail.closeError')}
        </p>
      )}
    </div>
  );
}

function SurveyPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="detail" label={t('routePending.label', { ns: 'nav' })} />;
}
