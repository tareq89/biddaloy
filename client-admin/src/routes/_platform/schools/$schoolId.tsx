/**
 * #535 (15.4.10) — the school detail page #533's list row and #534's
 * wizard success screen both link to. Replaces the placeholder that
 * shipped with #533 so `/schools/$schoolId` resolves to something real.
 *
 * No `GET /schools/:id` endpoint exists (only the list, `GET /schools`,
 * #533) — the header's name/slug/status come from `useSchools()`,
 * filtered to this `schoolId`, same "find in the already-fetched list"
 * approach `index.tsx`'s own row-click already relies on implicitly.
 * Stats (`GET /platform/schools/:id/stats`, #532) and admins (`GET
 * /schools/:id/admins`, #531) are fetched separately since neither is on
 * the list response.
 *
 * [31.4.platform-2] `DetailShell` without tabs (D16/D20): crumbs are the
 * way back, "Add admin" is the one filled button (D29), suspend lives in
 * the More menu, and the add-admin / SMS-credit forms are dialogs.
 */
import { StatusBadge, Skeleton, ErrorState } from '@biddaloy/ui/components';
import {
  ApprovalModalHostProvider,
  useSchools,
  useSchoolStats,
  useSchoolAdmins,
} from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { DetailShell, useDetailShellTab } from '@biddaloy/ui/shells';
import { formatDate } from '@biddaloy/ui/utils';
import { createFileRoute } from '@tanstack/react-router';
import { ArchiveRestoreIcon, LogInIcon, RotateCcwIcon, UserPlusIcon } from 'lucide-react';
import * as React from 'react';

import { LoginAsDialog } from '../../../features/cockpit/login-as/login-as-dialog';
import { ModulesTab } from '../../../features/cockpit/school-360/modules-tab';
import { OverviewTab } from '../../../features/cockpit/school-360/overview-tab';
import { PeopleTab } from '../../../features/cockpit/school-360/people-tab';
import { ArchiveSchoolDialog } from '../../../features/cockpit/school-controls/archive-school-dialog';
import { ExtendTrialDialog } from '../../../features/cockpit/school-controls/extend-trial-dialog';
import { RenameSchoolDialog } from '../../../features/cockpit/school-controls/rename-school-dialog';
import { StuckAdminDialog } from '../../../features/cockpit/school-controls/stuck-admin-dialog';
import { HealthTab } from '../../../features/cockpit/school-support/health-tab';
import { NotesTab } from '../../../features/cockpit/school-support/notes-tab';
import { SupportAccessTab } from '../../../features/cockpit/school-support/support-access-tab';
import { loadRouteNamespaces } from '../../../route-loaders';

import { AddAdminDialog } from './-detail/add-admin-form';
import { AdminsCard } from './-detail/admins-card';
import { ResetPresetCard } from './-detail/preset-reset-card';
import { RestoreWorkbookDialog } from './-detail/restore-workbook-dialog';
import { SeatsCard } from './-detail/seats-card';
import { SmsCreditsCard } from './-detail/sms-credits-card';
import { StatsCard } from './-detail/stats-card';
import { StatusActionDialog } from './-detail/status-action-dialog';

const TAB_IDS = ['overview', 'people', 'supportAccess', 'notes', 'health', 'modules'] as const;

export const Route = createFileRoute('/_platform/schools/$schoolId')({
  // The active tab is `?tab=`; an unknown value falls back to Overview (useDetailShellTab).
  validateSearch: (search: Record<string, unknown>): { tab?: string } =>
    typeof search.tab === 'string' ? { tab: search.tab } : {},
  loader: () =>
    loadRouteNamespaces(
      'platform',
      'backup',
      'bulkImport',
      'presetReset',
      'schoolControl',
      'schoolSupport',
      'school360',
      'settings',
      'loginAs',
      'moneyBilling',
      'moneyPlans',
      'common',
    ),
  component: SchoolDetailPage,
});

function SchoolDetailPage() {
  const { t } = useTranslation('platform');
  const { t: t360 } = useTranslation('school360');
  const [activeTab, setActiveTab] = useDetailShellTab(TAB_IDS);
  const config = useRegionConfig();
  const { schoolId } = Route.useParams();

  const schoolsQuery = useSchools();
  const school = schoolsQuery.data?.find((row) => row.id === schoolId);

  const statsQuery = useSchoolStats(schoolId);
  const adminsQuery = useSchoolAdmins(schoolId);

  const [statusDialogOpen, setStatusDialogOpen] = React.useState(false);
  const [restoreDialogOpen, setRestoreDialogOpen] = React.useState(false);
  const [addAdminOpen, setAddAdminOpen] = React.useState(false);
  const [dialog, setDialog] = React.useState<
    'loginAs' | 'extendTrial' | 'rename' | 'archive' | 'stuckAdmin' | null
  >(null);
  const closeDialog = (open: boolean) => {
    if (!open) setDialog(null);
  };

  if (schoolsQuery.isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (schoolsQuery.isError || !school) {
    return (
      <ErrorState
        message={t('schoolDetail.loadError')}
        retryLabel={t('actions.retry', { ns: 'common' })}
        onRetry={() => void schoolsQuery.refetch()}
      />
    );
  }

  const targetStatus = school.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE';

  const tabs = [
    {
      id: 'overview',
      label: t360('tabs.overview'),
      content: (
        <div className="space-y-6">
          <OverviewTab schoolId={schoolId} />
          <StatsCard
            {...(statsQuery.data !== undefined ? { stats: statsQuery.data } : {})}
            loading={statsQuery.isLoading}
            {...(statsQuery.isError ? { error: t('schoolDetail.stats.loadError') } : {})}
            onRetry={() => void statsQuery.refetch()}
          />
          <SeatsCard schoolId={schoolId} schoolName={school.name} />
          <div className="grid gap-6 md:grid-cols-2 md:items-start">
            <SmsCreditsCard schoolId={schoolId} />
            <ResetPresetCard schoolId={schoolId} schoolName={school.name} />
          </div>
        </div>
      ),
    },
    {
      id: 'people',
      label: t360('tabs.people'),
      content: (
        <PeopleTab
          schoolId={schoolId}
          onLoginAs={() => setDialog('loginAs')}
          onStuckAdmin={() => setDialog('stuckAdmin')}
        >
          <AdminsCard
            schoolId={schoolId}
            {...(adminsQuery.data !== undefined ? { admins: adminsQuery.data } : {})}
            loading={adminsQuery.isLoading}
            {...(adminsQuery.isError ? { error: t('schoolDetail.admins.loadError') } : {})}
            onRetry={() => void adminsQuery.refetch()}
            onAdd={() => setAddAdminOpen(true)}
          />
        </PeopleTab>
      ),
    },
    {
      id: 'supportAccess',
      label: t360('tabs.supportAccess'),
      content: <SupportAccessTab schoolId={schoolId} onLoginAs={() => setDialog('loginAs')} />,
    },
    { id: 'notes', label: t360('tabs.notes'), content: <NotesTab schoolId={schoolId} /> },
    { id: 'health', label: t360('tabs.health'), content: <HealthTab schoolId={schoolId} /> },
    { id: 'modules', label: t360('tabs.modules'), content: <ModulesTab schoolId={schoolId} /> },
  ];

  return (
    <ApprovalModalHostProvider>
      <DetailShell
        name={school.name}
        statusBadge={
          <StatusBadge
            tone={school.status === 'ACTIVE' ? 'success' : 'warning'}
            label={t(`schools.status.${school.status}`)}
          />
        }
        facts={[
          { label: t('schools.columnSlug'), value: school.slug },
          { label: t('schools.columnCreated'), value: formatDate(school.created_at, config) },
        ]}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        actions={[
          {
            id: 'loginAs',
            label: t360('header.loginAs'),
            icon: <LogInIcon aria-hidden="true" />,
            priority: 'secondary',
            keepOnPhone: true,
            onClick: () => setDialog('loginAs'),
          },
          {
            id: 'extendTrial',
            label: t360('header.extendTrial'),
            priority: 'tertiary',
            onClick: () => setDialog('extendTrial'),
          },
          {
            id: 'rename',
            label: t360('header.rename'),
            priority: 'tertiary',
            onClick: () => setDialog('rename'),
          },
          {
            id: 'stuckAdmin',
            label: t360('header.stuckAdmin'),
            priority: 'tertiary',
            onClick: () => setDialog('stuckAdmin'),
          },
          {
            id: 'archive',
            label: t360('header.archive'),
            priority: 'tertiary',
            onClick: () => setDialog('archive'),
          },
          {
            id: 'addAdmin',
            label: t('schoolDetail.admins.addAction'),
            icon: <UserPlusIcon aria-hidden="true" />,
            priority: 'primary',
            onClick: () => setAddAdminOpen(true),
          },
          ...(school.status === 'SUSPENDED'
            ? [
                {
                  id: 'statusAction',
                  label: t('schoolDetail.actions.reactivate'),
                  icon: <RotateCcwIcon aria-hidden="true" />,
                  priority: 'secondary' as const,
                  onClick: () => setStatusDialogOpen(true),
                },
              ]
            : []),
          {
            id: 'restoreFromWorkbookAction',
            label: t('schoolDetail.actions.restoreFromWorkbook'),
            icon: <ArchiveRestoreIcon aria-hidden="true" />,
            priority: 'tertiary',
            onClick: () => setRestoreDialogOpen(true),
          },
          ...(school.status === 'ACTIVE'
            ? [
                {
                  id: 'statusAction',
                  label: t('schoolDetail.actions.suspend'),
                  priority: 'destructive' as const,
                  onClick: () => setStatusDialogOpen(true),
                },
              ]
            : []),
        ]}
        tabs={tabs}
      />

      <AddAdminDialog schoolId={schoolId} open={addAdminOpen} onOpenChange={setAddAdminOpen} />

      <StatusActionDialog
        open={statusDialogOpen}
        onOpenChange={setStatusDialogOpen}
        schoolId={schoolId}
        schoolName={school.name}
        targetStatus={targetStatus}
      />

      <RestoreWorkbookDialog
        open={restoreDialogOpen}
        onOpenChange={setRestoreDialogOpen}
        schoolId={schoolId}
        schoolName={school.name}
      />

      <LoginAsDialog
        open={dialog === 'loginAs'}
        onOpenChange={closeDialog}
        schoolId={schoolId}
        schoolName={school.name}
        onInviteAdmin={() => {
          setDialog(null);
          setAddAdminOpen(true);
        }}
      />
      <ExtendTrialDialog
        open={dialog === 'extendTrial'}
        onOpenChange={closeDialog}
        schoolId={schoolId}
        schoolName={school.name}
      />
      <RenameSchoolDialog
        open={dialog === 'rename'}
        onOpenChange={closeDialog}
        schoolId={schoolId}
        currentName={school.name}
      />
      <ArchiveSchoolDialog
        open={dialog === 'archive'}
        onOpenChange={closeDialog}
        schoolId={schoolId}
        schoolName={school.name}
      />
      <StuckAdminDialog
        open={dialog === 'stuckAdmin'}
        onOpenChange={closeDialog}
        schoolId={schoolId}
        schoolName={school.name}
      />
    </ApprovalModalHostProvider>
  );
}
