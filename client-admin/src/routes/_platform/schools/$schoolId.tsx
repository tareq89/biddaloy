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
 * Header actions follow 8.14.16's `DetailShell` tier contract — the
 * Suspend/Reactivate action is `primary` (the one thing a SUPER_ADMIN
 * does most often from here), same `actions[]` shape `staff/$userId.tsx`
 * uses for its own edit/reset/remove actions.
 */
import { StatusBadge, Skeleton, ErrorState } from '@biddaloy/ui/components';
import { useSchools, useSchoolStats, useSchoolAdmins } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { DetailShell, useDetailShellTab } from '@biddaloy/ui/shells';
import { createFileRoute, Link } from '@tanstack/react-router';
import * as React from 'react';
import { z } from 'zod';

import { loadRouteNamespaces } from '../../../route-loaders';

import { AdminsCard } from './-detail/admins-card';
import { SmsCreditsCard } from './-detail/sms-credits-card';
import { StatsCard } from './-detail/stats-card';
import { StatusActionDialog } from './-detail/status-action-dialog';

const schoolDetailSearchSchema = z.object({
  // Same shape `staff/$userId.tsx` uses for `useDetailShellTab` — invalid
  // values fall back to the first tab there too.
  tab: z.string().optional(),
});

export const Route = createFileRoute('/_platform/schools/$schoolId')({
  validateSearch: schoolDetailSearchSchema,
  loader: () => loadRouteNamespaces('platform'),
  component: SchoolDetailPage,
});

function SchoolDetailPage() {
  const { t } = useTranslation('platform');
  const { schoolId } = Route.useParams();

  const schoolsQuery = useSchools();
  const school = schoolsQuery.data?.find((row) => row.id === schoolId);

  const statsQuery = useSchoolStats(schoolId);
  const adminsQuery = useSchoolAdmins(schoolId);

  const [statusDialogOpen, setStatusDialogOpen] = React.useState(false);

  const [activeTab, setActiveTab] = useDetailShellTab(['overview'] as const);

  if (schoolsQuery.isLoading) {
    return <Skeleton className="h-40 w-full" />;
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
    <div className="flex flex-col gap-4">
      <Link
        to="/schools"
        className="inline-flex min-h-6 items-center self-start text-sm text-primary underline"
      >
        {t('schoolDetail.back')}
      </Link>

      <DetailShell
        name={school.name}
        identifiers={school.slug}
        statusBadge={<StatusBadge domain="school" status={school.status} />}
        actions={[
          {
            id: 'statusAction',
            label:
              school.status === 'ACTIVE'
                ? t('schoolDetail.actions.suspend')
                : t('schoolDetail.actions.reactivate'),
            priority: school.status === 'ACTIVE' ? 'destructive' : 'primary',
            onClick: () => setStatusDialogOpen(true),
          },
        ]}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        tabs={[
          {
            id: 'overview',
            label: t('schoolDetail.tabs.overview'),
            content: (
              <div className="flex flex-col gap-4">
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
                />
                <SmsCreditsCard schoolId={schoolId} />
                <Link
                  to="/settings"
                  className="inline-flex min-h-6 items-center self-start text-sm text-primary underline"
                >
                  {t('schoolDetail.settingsLink')}
                </Link>
              </div>
            ),
          },
        ]}
      />

      <StatusActionDialog
        open={statusDialogOpen}
        onOpenChange={setStatusDialogOpen}
        schoolId={schoolId}
        schoolName={school.name}
        targetStatus={targetStatus}
      />
    </div>
  );
}
