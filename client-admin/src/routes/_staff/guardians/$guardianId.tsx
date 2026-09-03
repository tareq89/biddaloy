import { Permission } from '@biddaloy/shared';
import { ApiError } from '@biddaloy/ui/api';
import { ErrorState, RoutePending, Skeleton, StatusBadge } from '@biddaloy/ui/components';
import { guardianQueryOptions, useGuardian, useHasPermission } from '@biddaloy/ui/hooks';
import { RegionConfigProvider, useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { DetailShell, useDetailShellTab } from '@biddaloy/ui/shells';
import { createFileRoute, Link } from '@tanstack/react-router';
import * as React from 'react';
import { z } from 'zod';

import { loadRouteNamespaces } from '../../../route-loaders';

import { CommunicationTab } from './-detail/communication-tab';
import { InformationTab } from './-detail/information-tab';
import { LinkedStudentsTab } from './-detail/linked-students-tab';
import { PaymentsTab } from './-detail/payments-tab';
import { EditGuardianDialog } from './-edit-guardian-dialog';

const guardianDetailSearchSchema = z.object({
  // `useDetailShellTab` falls back to the first tab for anything not in
  // its own `tabIds` list, so an invalid value here isn't validated away
  // by the schema — it's handled once, there, not duplicated here.
  tab: z.string().optional(),
});

const TAB_IDS = ['information', 'linkedStudents', 'communication', 'payments'] as const;

/**
 * [8.11.4] — a standalone guardian page (Information, Linked Students,
 * Communication History, Payment History), mirroring
 * `students/$studentId.tsx`'s own `DetailShell`/`useDetailShellTab`
 * structure, so staff can find a guardian and see every student they're
 * responsible for without going through a student first.
 */
export const Route = createFileRoute('/_staff/guardians/$guardianId')({
  validateSearch: guardianDetailSearchSchema,
  loader: ({ context: { queryClient }, params }) =>
    Promise.all([
      // [8.14.5]: swallowed — see `academic-years/$academicYearId.tsx`'s
      // identical comment for why.
      queryClient.ensureQueryData(guardianQueryOptions(params.guardianId)).catch(() => undefined),
      loadRouteNamespaces('guardians', 'common'),
    ]),
  pendingComponent: GuardianDetailPending,
  component: GuardianDetailPage,
});

function GuardianDetailPage() {
  const { guardianId } = Route.useParams();
  const { t } = useTranslation('guardians');
  const guardianQuery = useGuardian(guardianId);
  const [activeTab, setActiveTab] = useDetailShellTab(TAB_IDS);

  const [editDialogOpen, setEditDialogOpen] = React.useState(false);

  const canUpdate = useHasPermission(Permission.GUARDIAN_UPDATE);
  // Payment/Communication tabs format currency and dates against the
  // active tenant's own region — same reasoning as `students/$studentId
  // .tsx`'s own `RegionConfigProvider` wrap: without it, every phone
  // number and amount on this page would silently fall back to
  // `RegionConfigProvider`'s hardcoded default region rather than the
  // active tenant's actual one.
  const regionConfig = useTenantRegionConfig();

  return (
    <RegionConfigProvider value={regionConfig}>
      <div className="flex flex-col gap-4">
        <Link
          to="/guardians"
          className="inline-flex min-h-6 items-center self-start text-sm text-primary underline"
        >
          {t('detail.back')}
        </Link>

        {guardianQuery.isPending ? (
          <Skeleton className="h-7 w-64" />
        ) : guardianQuery.isError ? (
          <ErrorState
            message={
              guardianQuery.error instanceof ApiError && guardianQuery.error.statusCode === 403
                ? t('detail.forbidden')
                : t('detail.loadError')
            }
            retryLabel={t('actions.retry', { ns: 'common' })}
            onRetry={() => void guardianQuery.refetch()}
          />
        ) : (
          <>
            <DetailShell
              name={guardianQuery.data.full_name}
              identifiers={t('detail.identifiers', {
                relationship: guardianQuery.data.relationship,
              })}
              statusBadge={
                <StatusBadge
                  domain="guardian"
                  status={guardianQuery.data.is_primary_contact ? 'PRIMARY' : 'SECONDARY'}
                />
              }
              actions={[
                {
                  id: 'edit',
                  label: t('detail.actions.edit'),
                  allowed: canUpdate,
                  priority: 'primary',
                  onClick: () => setEditDialogOpen(true),
                },
              ]}
              activeTab={activeTab}
              onTabChange={setActiveTab}
              tabs={[
                {
                  id: 'information',
                  label: t('detail.tabs.information'),
                  content: <InformationTab guardianId={guardianId} />,
                },
                {
                  id: 'linkedStudents',
                  label: t('detail.tabs.linkedStudents'),
                  content: <LinkedStudentsTab guardianId={guardianId} />,
                },
                {
                  id: 'communication',
                  label: t('detail.tabs.communication'),
                  content: <CommunicationTab guardianId={guardianId} />,
                },
                {
                  id: 'payments',
                  label: t('detail.tabs.payments'),
                  content: <PaymentsTab guardianId={guardianId} />,
                },
              ]}
            />

            <EditGuardianDialog
              open={editDialogOpen}
              onOpenChange={setEditDialogOpen}
              guardian={guardianQuery.data}
              config={regionConfig}
            />
          </>
        )}
      </div>
    </RegionConfigProvider>
  );
}

function GuardianDetailPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="detail" label={t('routePending.label', { ns: 'nav' })} />;
}
