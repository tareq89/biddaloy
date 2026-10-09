import { Permission } from '@biddaloy/shared';
import { ApiError } from '@biddaloy/ui/api';
import { ErrorState, RoutePending, StatusBadge } from '@biddaloy/ui/components';
import {
  APPLICATION_STATUS_TONE,
  applicationKeys,
  applicationQueryOptions,
  stepLabel,
  useApplication,
  useHasPermission,
} from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { DetailShell, PageContainer, type PageAction } from '@biddaloy/ui/shells';
import { formatDate } from '@biddaloy/ui/utils';
import { useQueryClient } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import {
  BanIcon,
  CircleCheckIcon,
  CircleXIcon,
  EyeIcon,
  PrinterIcon,
  UndoIcon,
} from 'lucide-react';
import * as React from 'react';
import { z } from 'zod';

import { loadRouteNamespaces, swallowUnlessOffline } from '../../../route-loaders';

import './-detail/-application-print.css';
import { ActivityPanel } from './-detail/activity-panel';
import { ApplicationBody } from './-detail/application-body';
import { DecisionDialogs, type DecisionKind } from './-detail/decision-dialogs';
import { followUpActions } from './-detail/follow-ups';

const searchSchema = z.object({
  // Set by the inbox list: focus lands on Approve, and a decision returns there.
  from: z.literal('inbox').optional().catch(undefined),
  // Set by a list row icon: open that dialog once the page has loaded.
  decide: z.enum(['approve', 'reject']).optional().catch(undefined),
});

export const Route = createFileRoute('/_staff/applications/$applicationId')({
  validateSearch: searchSchema,
  loader: ({ context: { queryClient }, params }) =>
    Promise.all([
      queryClient
        .ensureQueryData(applicationQueryOptions(params.applicationId))
        .catch(swallowUnlessOffline),
      // leave / feeStructures / printTemplates: field values and document names on this page.
      loadRouteNamespaces(
        'applicationsDetail',
        'applications',
        'applicationForms',
        'common',
        'nav',
        'leave',
        'feeStructures',
        'printTemplates',
      ),
    ]),
  pendingComponent: ApplicationDetailPending,
  component: ApplicationDetailPage,
});

function ApplicationDetailPage() {
  const { applicationId } = Route.useParams();
  const { from, decide } = Route.useSearch();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { t } = useTranslation('applicationsDetail');
  const { t: tApp } = useTranslation('applications');
  const { t: tKind } = useTranslation('printTemplates');
  const config = useRegionConfig();
  const query = useApplication(applicationId);
  const app = query.data;
  const [dialog, setDialog] = React.useState<DecisionKind | null>(null);

  const canPrint = useHasPermission(Permission.DOCUMENT_PRINT);
  const canMarks = useHasPermission(Permission.MARK_VIEW);
  const canSubstitute = useHasPermission(Permission.ROUTINE_MANAGE);

  // D25: arriving from the inbox, focus Approve after `useRouteFocus` has put focus on the <h1>.
  const canDecide = app?.can.decide ?? false;
  React.useEffect(() => {
    if (from !== 'inbox' || !canDecide) return;
    const timer = setTimeout(() => {
      document.querySelector<HTMLElement>('[data-action-id="approve"]')?.focus();
    }, 250);
    return () => clearTimeout(timer);
  }, [from, canDecide]);

  // `?decide=` from a list row icon: open that dialog once, then drop the key.
  const handledDecide = React.useRef(false);
  React.useEffect(() => {
    if (!decide || !app || handledDecide.current) return;
    handledDecide.current = true;
    if (app.can.decide) setDialog(decide);
    void navigate({ to: '.', search: (prev) => ({ ...prev, decide: undefined }), replace: true });
  }, [decide, app, navigate]);

  if (query.isPending) return <ApplicationDetailPending />;
  if (query.isError || !app) {
    const status = query.error instanceof ApiError ? query.error.statusCode : 0;
    return (
      <PageContainer>
        <ErrorState
          message={t(
            status === 404
              ? 'states.notFound'
              : status === 403
                ? 'states.forbidden'
                : 'states.loadError',
          )}
          onRetry={() => void query.refetch()}
          onHome={() => void navigate({ to: '/' })}
        />
      </PageContainer>
    );
  }

  const decided = app.decided_by_name !== null && app.decided_at !== null;
  const open = app.status === 'PENDING' || app.status === 'UNDER_CONSIDERATION';
  const subjectLine =
    app.subject_kind === 'STUDENT'
      ? t('facts.classLine', {
          class: app.subject_class_name ?? '',
          section: app.subject_section_name ?? '',
          roll: app.subject_roll ?? '',
        })
      : (app.subject_designation ?? '');

  const onDone = (kind: DecisionKind) => {
    setDialog(null);
    void queryClient.invalidateQueries({ queryKey: applicationKeys.all });
    if (from === 'inbox' && (kind === 'approve' || kind === 'reject')) {
      void navigate({ to: '/applications', search: { view: 'inbox', decided: app.id } });
    }
  };

  const actions: PageAction[] = [
    {
      id: 'approve',
      label: t('actions.approve'),
      icon: <CircleCheckIcon />,
      allowed: app.can.decide,
      priority: 'primary',
      onClick: () => setDialog('approve'),
    },
    {
      id: 'reject',
      label: t('actions.reject'),
      icon: <CircleXIcon />,
      allowed: app.can.decide,
      priority: 'secondary',
      onClick: () => setDialog('reject'),
    },
    {
      id: 'consider',
      label: t('actions.consider'),
      icon: <EyeIcon />,
      allowed: app.can.decide && app.can.consider && app.status !== 'UNDER_CONSIDERATION',
      priority: 'tertiary',
      onClick: () => setDialog('consider'),
    },
    {
      id: 'withdraw',
      label: t('actions.withdraw'),
      icon: <UndoIcon />,
      allowed: app.can.withdraw,
      priority: 'secondary',
      onClick: () => setDialog('withdraw'),
    },
    {
      id: 'cancel',
      label: t('actions.cancel'),
      icon: <BanIcon />,
      allowed: app.can.cancel,
      priority: 'tertiary',
      onClick: () => setDialog('cancel'),
    },
    ...followUpActions(
      app,
      { print: canPrint, marks: canMarks, substitute: canSubstitute },
      {
        print: (kind) => t('followUp.print', { document: tKind(`kind.${kind}`) }),
        marks: t('followUp.marks'),
        substitute: t('followUp.substitute'),
      },
    ),
    {
      id: 'print',
      label: t('actions.print'),
      icon: <PrinterIcon />,
      priority: 'tertiary',
      onClick: () => window.print(),
    },
  ];

  const applicant = app.applicant_role
    ? t('facts.withRole', { name: app.applicant_name, role: t(`roles.${app.applicant_role}`) })
    : app.applicant_name;

  return (
    <>
      <DetailShell
        name={`${tApp(`types.${app.type}`)} — ${app.applicant_name}`}
        statusBadge={
          <span>
            <StatusBadge
              tone={APPLICATION_STATUS_TONE[app.status]}
              label={tApp(`statuses.${app.status}`)}
            />
          </span>
        }
        facts={[
          { label: t('facts.number'), value: app.serial },
          {
            label: t('facts.applicant'),
            value:
              app.source === 'PAPER'
                ? t('facts.paper', { name: applicant, enteredBy: app.entered_by_name ?? '' })
                : applicant,
          },
          {
            label: t(app.subject_kind === 'STUDENT' ? 'facts.student' : 'facts.staff'),
            value: [app.subject_name, subjectLine].filter(Boolean).join(' · '),
          },
          { label: t('facts.submitted'), value: formatDate(app.created_at, config) },
          decided && !open
            ? {
                label: t('facts.decision'),
                value: t('facts.decisionValue', {
                  status: tApp(`statuses.${app.status}`),
                  by: app.decided_by_name,
                  date: formatDate(app.decided_at, config),
                }),
              }
            : {
                label: t('facts.step'),
                value: stepLabel(
                  app,
                  (key, options) => tApp(key, options as never) as unknown as string,
                  config,
                ),
              },
        ]}
        actions={actions}
      >
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <ApplicationBody app={app} />
          </div>
          <ActivityPanel app={app} />
        </div>
      </DetailShell>
      <DecisionDialogs kind={dialog} app={app} onClose={() => setDialog(null)} onDone={onDone} />
    </>
  );
}

function ApplicationDetailPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="detail" label={t('routePending.label', { ns: 'nav' })} />;
}
