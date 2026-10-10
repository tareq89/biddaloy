import { ApiError } from '@biddaloy/ui/api';
import { ErrorState, RoutePending, StatusBadge } from '@biddaloy/ui/components';
import {
  APPLICATION_STATUS_TONE,
  applicationQueryOptions,
  stepLabel,
  useApplication,
} from '@biddaloy/ui/hooks';
import { RegionConfigProvider, useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { DetailShell, PageContainer, PageHeader, type PageAction } from '@biddaloy/ui/shells';
import { formatDate } from '@biddaloy/ui/utils';
import { createFileRoute, Link } from '@tanstack/react-router';
import { ArrowLeftIcon, PrinterIcon, UndoIcon } from 'lucide-react';
import * as React from 'react';

import { loadRouteNamespaces, swallowUnlessOffline } from '../../../route-loaders';
import '../../_staff/applications/-detail/-application-print.css';
import { ActivityPanel } from '../../_staff/applications/-detail/activity-panel';
import { ApplicationBody } from '../../_staff/applications/-detail/application-body';
import { DecisionDialogs } from '../../_staff/applications/-detail/decision-dialogs';

/** [52.6.1] The family's view of one application: follow, comment, withdraw. Never decide. */
export const Route = createFileRoute('/portal/applications/$applicationId')({
  loader: ({ context: { queryClient }, params }) =>
    Promise.all([
      queryClient
        .ensureQueryData(applicationQueryOptions(params.applicationId))
        .catch(swallowUnlessOffline),
      loadRouteNamespaces(
        'portalApplications',
        'applicationsDetail',
        'applications',
        'applicationForms',
        'leave',
        'feeStructures',
        'common',
        'nav',
      ),
    ]),
  pendingComponent: PortalApplicationDetailPending,
  component: PortalApplicationDetailRoute,
});

function PortalApplicationDetailRoute() {
  return (
    <RegionConfigProvider>
      <PortalApplicationDetailPage />
    </RegionConfigProvider>
  );
}

function PortalApplicationDetailPage() {
  const { applicationId } = Route.useParams();
  const { t } = useTranslation('portalApplications');
  const { t: tDetail } = useTranslation('applicationsDetail');
  const { t: tApp } = useTranslation('applications');
  const config = useRegionConfig();
  const query = useApplication(applicationId);
  const app = query.data;
  const [withdrawing, setWithdrawing] = React.useState(false);
  const [notice, setNotice] = React.useState<string | undefined>();
  // After a withdraw the Withdraw button is gone, so the dialog has nothing to hand focus back to.
  // Queued after the dialog's own (unmount) focus restore, which would otherwise land on <body>.
  const [refocus, setRefocus] = React.useState(false);
  React.useEffect(() => {
    if (!refocus) return;
    const id = setTimeout(() => {
      const heading = document.querySelector<HTMLElement>('main h1');
      if (heading) {
        heading.tabIndex = -1;
        heading.focus();
      }
      setRefocus(false);
    });
    return () => clearTimeout(id);
  }, [refocus]);

  if (query.isPending) return <PortalApplicationDetailPending />;
  if (query.isError || !app) {
    const notFound = query.error instanceof ApiError && query.error.statusCode === 404;
    return (
      // The <h1> keeps `useRouteFocus` a target; a 404 gets no "Try again" (it can never succeed).
      <PageContainer>
        <PageHeader title={t('title')} />
        {notFound ? (
          <p role="alert">{t('detail.notFound')}</p>
        ) : (
          <ErrorState message={tDetail('states.loadError')} onRetry={() => void query.refetch()} />
        )}
        <Link
          to="/portal/applications"
          className="inline-flex min-h-11 items-center font-medium text-primary underline"
        >
          {t('detail.toList')}
        </Link>
      </PageContainer>
    );
  }

  const decided = app.decided_by_name !== null && app.decided_at !== null;
  const open = app.status === 'PENDING' || app.status === 'UNDER_CONSIDERATION';
  const translate = (key: string, options?: Record<string, unknown>) =>
    tApp(key, options as never) as unknown as string;
  // Only Withdraw and Print: whatever `can` says, a family never approves, rejects or cancels.
  const actions: PageAction[] = [
    {
      id: 'withdraw',
      label: tDetail('actions.withdraw'),
      icon: <UndoIcon />,
      allowed: app.can.withdraw,
      priority: 'secondary',
      onClick: () => setWithdrawing(true),
    },
    {
      id: 'print',
      label: tDetail('actions.print'),
      icon: <PrinterIcon />,
      priority: 'tertiary',
      onClick: () => window.print(),
    },
  ];

  return (
    <>
      <div className="mx-4 mt-3 print:hidden">
        <Link
          to="/portal/applications"
          {...(app.subject_student_id ? { search: { student: app.subject_student_id } } : {})}
          className="inline-flex min-h-11 items-center gap-1 font-medium text-primary"
        >
          <ArrowLeftIcon className="size-4" aria-hidden="true" />
          {t('back')}
        </Link>
      </div>
      {notice && (
        <p role="alert" className="mx-4 mt-3 text-destructive">
          {notice}
        </p>
      )}
      <DetailShell
        name={`${tApp(`types.${app.type}`)} — ${app.subject_name}`}
        statusBadge={
          <span>
            <StatusBadge
              tone={APPLICATION_STATUS_TONE[app.status]}
              label={tApp(`statuses.${app.status}`)}
            />
          </span>
        }
        facts={[
          { label: tDetail('facts.number'), value: <span dir="ltr">{app.serial}</span> },
          { label: tDetail('facts.submitted'), value: formatDate(app.created_at, config) },
          { label: tDetail('facts.applicant'), value: app.applicant_name },
          decided && !open
            ? {
                label: tDetail('facts.decision'),
                value: tDetail('facts.decisionValue', {
                  status: tApp(`statuses.${app.status}`),
                  by: app.decided_by_name,
                  date: formatDate(app.decided_at, config),
                }),
              }
            : {
                label: tDetail('facts.step'),
                value: stepLabel(app, translate, config),
              },
        ]}
        actions={actions}
      >
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <ApplicationBody app={app} />
          </div>
          <ActivityPanel app={app} canTag={false} />
        </div>
      </DetailShell>
      <DecisionDialogs
        kind={withdrawing ? 'withdraw' : null}
        app={app}
        onClose={() => setWithdrawing(false)}
        onDone={() => {
          setWithdrawing(false);
          setNotice(undefined);
          setRefocus(true);
        }}
        onNotice={setNotice}
      />
    </>
  );
}

function PortalApplicationDetailPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="detail" label={t('routePending.label', { ns: 'nav' })} />;
}
