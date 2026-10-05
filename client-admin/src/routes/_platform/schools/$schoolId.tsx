/**
 * #535 (15.4.10) — the school detail page #533's list row and #534's
 * wizard success screen both link to. Replaces the placeholder that
 * shipped with #533 so `/schools/$schoolId` resolves to something real.
 *
 * No `GET /schools/:id` endpoint exists (only the list, `GET /schools`,
 * #533) — the header's name/slug/status come from `useSchools()`,
 * filtered to this `schoolId`, same "find in the already-fetched list"
 * approach `index.tsx`'s own row-click already relies on implicitly.
 * Stats (`GET /schools/:id/stats`, #532) and admins (`GET
 * /schools/:id/admins`, #531) are fetched separately since neither is on
 * the list response.
 *
 * [31.4.platform-2] `DetailShell` without tabs (D16/D20): crumbs are the
 * way back, "Add admin" is the one filled button (D29), suspend lives in
 * the More menu, and the add-admin / SMS-credit forms are dialogs.
 */
import { StatusBadge, Skeleton, ErrorState } from '@biddaloy/ui/components';
import { useSchools, useSchoolStats, useSchoolAdmins } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { DetailShell } from '@biddaloy/ui/shells';
import { formatDate } from '@biddaloy/ui/utils';
import { createFileRoute } from '@tanstack/react-router';
import { ArchiveRestoreIcon, RotateCcwIcon, UserPlusIcon } from 'lucide-react';
import * as React from 'react';

import { loadRouteNamespaces } from '../../../route-loaders';

import { AddAdminDialog } from './-detail/add-admin-form';
import { AdminsCard } from './-detail/admins-card';
import { ResetPresetCard } from './-detail/preset-reset-card';
import { RestoreWorkbookDialog } from './-detail/restore-workbook-dialog';
import { SmsCreditsCard } from './-detail/sms-credits-card';
import { StatsCard } from './-detail/stats-card';
import { StatusActionDialog } from './-detail/status-action-dialog';

export const Route = createFileRoute('/_platform/schools/$schoolId')({
  loader: () => loadRouteNamespaces('platform', 'backup', 'bulkImport', 'presetReset'),
  component: SchoolDetailPage,
});

function SchoolDetailPage() {
  const { t } = useTranslation('platform');
  const config = useRegionConfig();
  const { schoolId } = Route.useParams();

  const schoolsQuery = useSchools();
  const school = schoolsQuery.data?.find((row) => row.id === schoolId);

  const statsQuery = useSchoolStats(schoolId);
  const adminsQuery = useSchoolAdmins(schoolId);

  const [statusDialogOpen, setStatusDialogOpen] = React.useState(false);
  const [restoreDialogOpen, setRestoreDialogOpen] = React.useState(false);
  const [addAdminOpen, setAddAdminOpen] = React.useState(false);

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

  return (
    <>
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
        actions={[
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
      >
        <StatsCard
          {...(statsQuery.data !== undefined ? { stats: statsQuery.data } : {})}
          loading={statsQuery.isLoading}
          {...(statsQuery.isError ? { error: t('schoolDetail.stats.loadError') } : {})}
          onRetry={() => void statsQuery.refetch()}
        />
        <AdminsCard
          schoolId={schoolId}
          {...(adminsQuery.data !== undefined ? { admins: adminsQuery.data } : {})}
          loading={adminsQuery.isLoading}
          {...(adminsQuery.isError ? { error: t('schoolDetail.admins.loadError') } : {})}
          onRetry={() => void adminsQuery.refetch()}
          onAdd={() => setAddAdminOpen(true)}
        />
        <div className="grid gap-6 md:grid-cols-2 md:items-start">
          <SmsCreditsCard schoolId={schoolId} />
          <ResetPresetCard schoolId={schoolId} schoolName={school.name} />
        </div>
      </DetailShell>

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
    </>
  );
}
