/**
 * [28.4.2] One survey — `/staff/evaluations/surveys/$surveyId`. The file name's
 * `evaluations_` opts out of nesting under `evaluations.tsx` (which has no
 * `<Outlet />`), same escape as `$userId_.acr.$assessmentId.tsx`.
 * Gated on `ACR_READ` (`route-permissions.ts`); publish/close need `ACR_WRITE`.
 */
import { Permission } from '@biddaloy/shared';
import {
  ConfirmDialog,
  ErrorState,
  RoutePending,
  Skeleton,
  StatusBadge,
  toast,
} from '@biddaloy/ui/components';
import { useCloseSurvey, useHasPermission, usePublishSurvey, useSurvey } from '@biddaloy/ui/hooks';
import { useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { DetailShell } from '@biddaloy/ui/shells';
import { formatDate, formatNumber } from '@biddaloy/ui/utils';
import { createFileRoute } from '@tanstack/react-router';
import * as React from 'react';

import { loadRouteNamespaces } from '../../../route-loaders';

import { SurveyResults } from './-evaluations/survey-results';
import { SURVEY_STATUS_TONE } from './-evaluations/surveys-list';

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
  const [closeOpen, setCloseOpen] = React.useState(false);

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
    <>
      <DetailShell
        name={survey.title}
        statusBadge={
          <StatusBadge
            tone={SURVEY_STATUS_TONE[survey.status] ?? 'neutral'}
            label={t(`surveys.status.${survey.status}`)}
          />
        }
        facts={[
          {
            label: t('surveys.columnRespondents'),
            value: t(`surveys.respondents.${survey.respondent}`),
          },
          {
            label: t('surveys.detail.identityLabel'),
            value: t(
              survey.anonymous ? 'surveys.detail.identityHidden' : 'surveys.detail.identityShown',
            ),
          },
          { label: t('surveys.detail.opensAt'), value: date(survey.opens_at) },
          { label: t('surveys.detail.closesAt'), value: date(survey.closes_at) },
          {
            label: t('surveys.detail.minResponsesLabel'),
            value: t('surveys.detail.minResponsesValue', {
              count: formatNumber(survey.min_responses, regionConfig),
            }),
          },
        ]}
        actions={[
          {
            id: 'publish',
            label: publish.isPending ? t('surveys.detail.publishing') : t('surveys.detail.publish'),
            priority: 'primary',
            allowed: canWrite && survey.status === 'DRAFT' && !publish.isPending,
            onClick: () =>
              publish.mutate(survey.id, {
                onSuccess: () => toast.success(t('surveys.form.published')),
                onError: () => toast.error(t('surveys.detail.publishError')),
              }),
          },
          {
            id: 'close',
            label: close.isPending ? t('surveys.detail.closing') : t('surveys.detail.close'),
            priority: 'primary',
            allowed: canWrite && survey.status === 'OPEN' && !close.isPending,
            onClick: () => setCloseOpen(true),
          },
        ]}
      >
        <SurveyResults surveyId={survey.id} status={survey.status} />
      </DetailShell>
      <ConfirmDialog
        open={closeOpen}
        onOpenChange={setCloseOpen}
        tone="default"
        title={t('surveys.detail.closeConfirm.title')}
        description={t('surveys.detail.closeConfirm.description', { title: survey.title })}
        confirmLabel={t('surveys.detail.close')}
        busy={close.isPending}
        onConfirm={() =>
          close.mutate(survey.id, {
            onSuccess: () => setCloseOpen(false),
            onError: () => {
              setCloseOpen(false);
              toast.error(t('surveys.detail.closeError'));
            },
          })
        }
      />
    </>
  );
}

function SurveyPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="detail" label={t('routePending.label', { ns: 'nav' })} />;
}
