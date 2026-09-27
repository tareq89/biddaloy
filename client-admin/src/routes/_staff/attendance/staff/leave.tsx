/**
 * [36.4] `/attendance/staff/leave` — "My leave" (balance + request) for
 * every signed-in staff member, plus a pending-approvals panel gated on
 * `LEAVE_APPROVE` (see `-leave-approve-list.tsx`'s own comment for why
 * that panel can't be wired up end to end yet).
 */
import { Permission } from '@biddaloy/shared';
import { Button, ErrorState, Skeleton } from '@biddaloy/ui/components';
import { useCurrentUser, useHasPermission, useLeaveBalance } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { createFileRoute } from '@tanstack/react-router';
import * as React from 'react';

import { loadRouteNamespaces } from '../../../../route-loaders';

import { LeaveApproveList } from './-leave-approve-list';
import { LeaveRequestDialog } from './-leave-request-dialog';

export const Route = createFileRoute('/_staff/attendance/staff/leave')({
  loader: () => loadRouteNamespaces('leave', 'common'),
  component: LeavePage,
});

function LeavePage() {
  const { t } = useTranslation('leave');
  const canApprove = useHasPermission(Permission.LEAVE_APPROVE);
  const currentUserQuery = useCurrentUser();
  const staffProfileId = currentUserQuery.data?.staff_profile_id ?? null;
  const balanceQuery = useLeaveBalance(staffProfileId ?? '');
  const [requestOpen, setRequestOpen] = React.useState(false);

  return (
    <div className="flex flex-col gap-6 p-4">
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-lg font-semibold">{t('myLeave.title')}</h1>
          {staffProfileId !== null && (
            <Button type="button" onClick={() => setRequestOpen(true)}>
              {t('myLeave.requestButton')}
            </Button>
          )}
        </div>

        {currentUserQuery.isPending ? (
          <div aria-busy="true" aria-live="polite">
            <span className="sr-only">{t('myLeave.loading')}</span>
            <Skeleton className="h-32 w-full" />
          </div>
        ) : staffProfileId === null ? (
          <p className="text-sm text-muted-foreground">{t('myLeave.empty')}</p>
        ) : balanceQuery.isPending ? (
          <div aria-busy="true" aria-live="polite">
            <span className="sr-only">{t('myLeave.loading')}</span>
            <Skeleton className="h-32 w-full" />
          </div>
        ) : balanceQuery.isError ? (
          <ErrorState
            message={t('myLeave.errorMessage')}
            retryLabel={t('actions.retry', { ns: 'common' })}
            onRetry={() => void balanceQuery.refetch()}
          />
        ) : balanceQuery.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('myLeave.empty')}</p>
        ) : (
          <table className="w-full border-collapse text-sm">
            <caption className="sr-only">{t('myLeave.balanceTitle')}</caption>
            <thead>
              <tr className="border-b border-border-subtle">
                <th scope="col" className="p-1.5 text-start font-medium">
                  {t('myLeave.columnType')}
                </th>
                <th scope="col" className="p-1.5 text-end font-medium">
                  {t('myLeave.columnQuota')}
                </th>
                <th scope="col" className="p-1.5 text-end font-medium">
                  {t('myLeave.columnUsed')}
                </th>
                <th scope="col" className="p-1.5 text-end font-medium">
                  {t('myLeave.columnBalance')}
                </th>
              </tr>
            </thead>
            <tbody>
              {balanceQuery.data.map((row) => (
                <tr key={row.leave_type} className="border-b border-border-subtle">
                  <td className="p-1.5">{t(`type.${row.leave_type}`)}</td>
                  <td className="p-1.5 text-end">{row.annual_quota_days}</td>
                  <td className="p-1.5 text-end">{row.used_days}</td>
                  <td className="p-1.5 text-end">{row.balance}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {canApprove && <LeaveApproveList />}

      {staffProfileId !== null && (
        <LeaveRequestDialog
          open={requestOpen}
          onOpenChange={setRequestOpen}
          staffProfileId={staffProfileId}
        />
      )}
    </div>
  );
}
