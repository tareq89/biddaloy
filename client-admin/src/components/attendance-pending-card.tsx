/**
 * [41.4.2] "Today's attendance" dashboard card. Reads the same
 * `GET /attendance/my-sections` data as `/attendance` (admin sees the
 * whole school, a teacher sees their own sections — server-scoped), counts
 * the sections that still have to be finalized today and links to the
 * pending list. Never blocks the dashboard: own skeleton, own error + retry.
 */
import { Permission } from '@biddaloy/shared';
import { Button, Card, Skeleton, StatusBadge } from '@biddaloy/ui/components';
import { mySectionsQueryOptions, useHasPermission } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatNumber } from '@biddaloy/ui/utils';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { RotateCcwIcon } from 'lucide-react';

export function AttendancePendingCard() {
  const { t } = useTranslation('attendance');
  const { t: tCommon } = useTranslation('common');
  const regionConfig = useRegionConfig();
  const canRead = useHasPermission(Permission.ATTENDANCE_READ);
  // Gated, so a viewer without ATTENDANCE_READ never calls the endpoint.
  const query = useQuery({ ...mySectionsQueryOptions(), enabled: canRead });

  if (!canRead) return null;

  if (query.isPending) {
    return (
      <Card className="flex flex-col gap-2 p-4 md:p-5" aria-busy="true">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-4 w-full" />
      </Card>
    );
  }

  if (query.isError) {
    return (
      <Card className="p-4 md:p-5">
        <h2 className="text-h2">{t('dashboardCard.title')}</h2>
        <p className="mt-1 text-text-secondary">{t('list.errorMessage')}</p>
        <Button
          type="button"
          variant="outline"
          className="mt-3"
          onClick={() => void query.refetch()}
        >
          <RotateCcwIcon aria-hidden="true" />
          {tCommon('actions.retry')}
        </Button>
      </Card>
    );
  }

  const sections = query.data.filter((section) => section.student_count > 0);
  if (sections.length === 0) return null;

  const holiday = sections.every((section) => !section.is_working_day);
  const pending = sections.filter(
    (section) => section.today === null || section.today.state !== 'FINALIZED',
  ).length;

  return (
    <Card className="p-4 md:p-5">
      <h2 className="text-h2">{t('dashboardCard.title')}</h2>
      <div className="mt-2">
        {holiday ? (
          <p className="text-text-secondary">{t('dashboardCard.holiday')}</p>
        ) : pending > 0 ? (
          <StatusBadge
            tone="warning"
            label={t('dashboardCard.pending', {
              pending: formatNumber(pending, regionConfig),
              total: formatNumber(sections.length, regionConfig),
            })}
          />
        ) : (
          <StatusBadge tone="success" label={t('dashboardCard.allDone')} />
        )}
      </div>
      {!holiday && pending > 0 && (
        <Link
          to="/attendance"
          search={{ status: 'pending' }}
          className="mt-2 flex min-h-11 w-full items-center font-medium no-underline hover:bg-muted"
        >
          {t('dashboardCard.open')}
        </Link>
      )}
    </Card>
  );
}
