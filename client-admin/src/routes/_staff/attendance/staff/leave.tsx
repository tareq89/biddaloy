/**
 * [36.4] `/attendance/staff/leave` — "My leave" (balance) for every signed-in
 * staff member. Requesting and deciding leave happen on the applications pages
 * (D20): the header button opens the new-application form, and a `LEAVE_APPROVE`
 * holder gets a link to the pending STAFF_LEAVE inbox.
 */
import { ApplicationType, Permission } from '@biddaloy/shared';
import {
  Button,
  DataTable,
  EmptyState,
  ErrorState,
  type DataTableColumn,
} from '@biddaloy/ui/components';
import { useCurrentUser, useHasPermission, useLeaveBalance } from '@biddaloy/ui/hooks';
import { useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { PageContainer, PageHeader } from '@biddaloy/ui/shells';
import { formatNumber } from '@biddaloy/ui/utils';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { CalendarX2, Plus, UserX } from 'lucide-react';

import { loadRouteNamespaces } from '../../../../route-loaders';

export const Route = createFileRoute('/_staff/attendance/staff/leave')({
  loader: () => loadRouteNamespaces('leave', 'common'),
  component: LeavePage,
});

type BalanceRow = NonNullable<ReturnType<typeof useLeaveBalance>['data']>[number];

function LeavePage() {
  const { t } = useTranslation('leave');
  const regionConfig = useTenantRegionConfig();
  const canApprove = useHasPermission(Permission.LEAVE_APPROVE);
  const currentUserQuery = useCurrentUser();
  const staffProfileId = currentUserQuery.data?.staff_profile_id ?? null;
  const balanceQuery = useLeaveBalance(staffProfileId ?? '');
  const navigate = useNavigate();

  const columns: DataTableColumn<BalanceRow>[] = [
    {
      id: 'type',
      header: t('myLeave.columnType'),
      accessorFn: (row) => t(`type.${row.leave_type}`),
      card: 'title',
    },
    {
      id: 'quota',
      header: t('myLeave.columnQuota'),
      // null quota = unlimited (D19)
      accessorFn: (row) =>
        row.annual_quota_days === null
          ? t('myLeave.noLimit')
          : formatNumber(row.annual_quota_days, regionConfig),
      align: 'end',
    },
    {
      id: 'used',
      header: t('myLeave.columnUsed'),
      accessorFn: (row) => formatNumber(row.used_days, regionConfig),
      align: 'end',
    },
    {
      id: 'balance',
      header: t('myLeave.columnBalance'),
      accessorFn: (row) => (
        <>
          <span className="hidden md:inline">
            {row.balance === null ? '—' : formatNumber(row.balance, regionConfig)}
          </span>
          <span className="md:hidden">
            {row.balance === null
              ? t('myLeave.noLimit')
              : // `count` picks the plural form; `n` is the school-formatted number.
                t('myLeave.daysLeft', {
                  count: row.balance,
                  n: formatNumber(row.balance, regionConfig),
                })}
          </span>
        </>
      ),
      align: 'end',
      card: 'badge',
    },
  ];

  const tableProps = {
    tableId: 'leave-balance',
    caption: t('myLeave.title'),
    columns,
    getRowId: (row: BalanceRow) => row.leave_type,
    sorting: null,
    onSortingChange: () => undefined,
    paginated: false,
  } as const;

  return (
    <PageContainer>
      <PageHeader
        title={t('items.leave', { ns: 'nav' })}
        subtitle={t('page.subtitle')}
        actions={
          staffProfileId !== null
            ? [
                {
                  id: 'request',
                  label: t('myLeave.requestButton'),
                  priority: 'primary',
                  icon: <Plus aria-hidden="true" />,
                  onClick: () =>
                    void navigate({
                      to: '/applications/new',
                      search: { type: ApplicationType.STAFF_LEAVE },
                    }),
                },
              ]
            : []
        }
      />

      <section aria-labelledby="leave-balance" className="space-y-3">
        <h2 id="leave-balance" className="text-h2">
          {t('myLeave.title')}
        </h2>
        {currentUserQuery.isPending ? (
          <DataTable {...tableProps} data={[]} totalCount={0} loading />
        ) : staffProfileId === null ? (
          <EmptyState
            icon={<UserX />}
            title={t('myLeave.noProfileTitle')}
            explanation={t('myLeave.noProfileMessage')}
          />
        ) : balanceQuery.isPending ? (
          <DataTable {...tableProps} data={[]} totalCount={0} loading />
        ) : balanceQuery.isError ? (
          <ErrorState
            message={t('myLeave.errorMessage')}
            retryLabel={t('actions.retry', { ns: 'common' })}
            onRetry={() => void balanceQuery.refetch()}
          />
        ) : balanceQuery.data.length === 0 ? (
          <EmptyState
            icon={<CalendarX2 />}
            title={t('myLeave.emptyTitle')}
            explanation={t('myLeave.empty')}
          />
        ) : (
          <DataTable
            {...tableProps}
            data={balanceQuery.data}
            totalCount={balanceQuery.data.length}
          />
        )}
      </section>

      {canApprove && (
        <Button asChild variant="outline" className="self-start">
          <Link to="/applications" search={{ view: 'inbox', type: ApplicationType.STAFF_LEAVE }}>
            {t('myLeave.pendingLink')}
          </Link>
        </Button>
      )}
    </PageContainer>
  );
}
