/**
 * [36.4] Staff detail's "Attendance & Leave" tab — this one staff
 * member's attendance (mark today's status + this month's summary) and
 * leave (balance + request), scoped by `staffProfileId` rather than the
 * whole-roster grid `../../attendance/staff/index.tsx` renders.
 */
import { AttendanceStatus, Permission } from '@biddaloy/shared';
import { AttendanceStatusControl, Button, ErrorState, Skeleton } from '@biddaloy/ui/components';
import {
  useHasPermission,
  useLeaveBalance,
  useMarkStaffAttendance,
  useStaffAttendanceSummary,
} from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatNumber } from '@biddaloy/ui/utils';
import * as React from 'react';

import { LeaveRequestDialog } from '../../attendance/staff/-leave-request-dialog';

export interface AttendanceLeaveTabProps {
  staffProfileId: string;
  staffName: string;
}

function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function monthStartIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
}

export function AttendanceLeaveTab({ staffProfileId, staffName }: AttendanceLeaveTabProps) {
  const { t } = useTranslation('staffAttendance');
  const { t: tLeave } = useTranslation('leave');
  const { t: ts } = useTranslation('staff');
  const regionConfig = useRegionConfig();
  const canMark = useHasPermission(Permission.STAFF_ATTENDANCE_MARK);
  const [todayStatus, setTodayStatus] = React.useState<AttendanceStatus | null>(null);
  const [requestOpen, setRequestOpen] = React.useState(false);
  const markAttendance = useMarkStaffAttendance();
  const summaryQuery = useStaffAttendanceSummary(staffProfileId, monthStartIso(), todayIso());
  const balanceQuery = useLeaveBalance(staffProfileId);

  function handleStatusChange(status: AttendanceStatus) {
    setTodayStatus(status);
    markAttendance.mutate({
      date: todayIso(),
      entries: [{ staff_profile_id: staffProfileId, status }],
    });
  }

  const num = (n: number) => formatNumber(n, regionConfig);
  const figures = summaryQuery.data
    ? [
        ['summary.present', num(summaryQuery.data.present_days)],
        ['summary.absent', num(summaryQuery.data.absent_days)],
        ['summary.late', num(summaryQuery.data.late_days)],
        ['summary.leave', num(summaryQuery.data.leave_days)],
        [
          'summary.percentage',
          summaryQuery.data.attendance_percentage === null
            ? '—'
            : `${num(summaryQuery.data.attendance_percentage)}%`,
        ],
      ]
    : [];

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-border-subtle bg-surface p-4 shadow-e1 md:p-5">
        <h2 className="text-h2">{ts('detail.attendanceLeave.todayTitle')}</h2>
        {canMark && (
          <div className="mt-4">
            <AttendanceStatusControl
              value={todayStatus}
              onChange={handleStatusChange}
              disabled={markAttendance.isPending}
              studentName={staffName}
              variant="expanded"
            />
          </div>
        )}
        {markAttendance.isError && (
          <p role="alert" className="mt-2 text-caption text-destructive">
            {t('grid.errorMessage')}
          </p>
        )}
      </section>

      <section className="rounded-lg border border-border-subtle bg-surface p-4 shadow-e1 md:p-5">
        <h2 className="text-h2">{ts('detail.attendanceLeave.monthTitle')}</h2>
        <div className="mt-4">
          {summaryQuery.isPending ? (
            <Skeleton className="h-16 w-full" />
          ) : summaryQuery.isError ? (
            <ErrorState
              message={t('summary.errorMessage')}
              retryLabel={t('actions.retry', { ns: 'common' })}
              onRetry={() => void summaryQuery.refetch()}
            />
          ) : (
            <dl className="grid grid-cols-2 gap-4 md:grid-cols-5">
              {figures.map(([key, value]) => (
                <div key={key}>
                  <dt className="text-caption text-text-secondary">{t(key as string)}</dt>
                  <dd className="text-h3">{value}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      </section>

      <section className="rounded-lg border border-border-subtle bg-surface p-4 shadow-e1 md:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-h2">{ts('detail.attendanceLeave.leaveTitle')}</h2>
          <Button type="button" variant="outline" onClick={() => setRequestOpen(true)}>
            {tLeave('myLeave.requestButton')}
          </Button>
        </div>
        <div className="mt-4">
          {balanceQuery.isPending ? (
            <Skeleton className="h-16 w-full" />
          ) : balanceQuery.isError ? (
            <ErrorState
              message={tLeave('myLeave.errorMessage')}
              retryLabel={t('actions.retry', { ns: 'common' })}
              onRetry={() => void balanceQuery.refetch()}
            />
          ) : balanceQuery.data.length === 0 ? (
            <p className="text-text-secondary">{tLeave('myLeave.empty')}</p>
          ) : (
            <ul className="divide-y divide-border-subtle">
              {balanceQuery.data.map((row) => (
                <li key={row.leave_type} className="flex min-h-11 items-center justify-between">
                  <span>{tLeave(`type.${row.leave_type}`)}</span>
                  <span>{num(row.balance)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <LeaveRequestDialog
        open={requestOpen}
        onOpenChange={setRequestOpen}
        staffProfileId={staffProfileId}
      />
    </div>
  );
}
