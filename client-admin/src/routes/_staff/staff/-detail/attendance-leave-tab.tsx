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
import { useTranslation } from '@biddaloy/ui/i18n';
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

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">{t('grid.title')}</h2>
        {canMark && (
          <AttendanceStatusControl
            value={todayStatus}
            onChange={handleStatusChange}
            disabled={markAttendance.isPending}
            studentName={staffName}
            variant="expanded"
          />
        )}
        {markAttendance.isError && (
          <p role="alert" className="text-sm text-destructive">
            {t('grid.errorMessage')}
          </p>
        )}

        <h3 className="text-sm font-medium text-muted-foreground">{t('summary.title')}</h3>
        {summaryQuery.isPending ? (
          <Skeleton className="h-16 w-full" />
        ) : summaryQuery.isError ? (
          <ErrorState
            message={t('summary.errorMessage')}
            retryLabel={t('actions.retry', { ns: 'common' })}
            onRetry={() => void summaryQuery.refetch()}
          />
        ) : (
          <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-5">
            <div>
              <dt className="text-muted-foreground">{t('summary.present')}</dt>
              <dd className="font-medium">{summaryQuery.data.present_days}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t('summary.absent')}</dt>
              <dd className="font-medium">{summaryQuery.data.absent_days}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t('summary.late')}</dt>
              <dd className="font-medium">{summaryQuery.data.late_days}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t('summary.leave')}</dt>
              <dd className="font-medium">{summaryQuery.data.leave_days}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t('summary.percentage')}</dt>
              <dd className="font-medium">
                {summaryQuery.data.attendance_percentage === null
                  ? '—'
                  : `${summaryQuery.data.attendance_percentage}%`}
              </dd>
            </div>
          </dl>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">{tLeave('myLeave.title')}</h2>
          <Button type="button" variant="outline" onClick={() => setRequestOpen(true)}>
            {tLeave('myLeave.requestButton')}
          </Button>
        </div>
        {balanceQuery.isPending ? (
          <Skeleton className="h-16 w-full" />
        ) : balanceQuery.isError ? (
          <ErrorState
            message={tLeave('myLeave.errorMessage')}
            retryLabel={t('actions.retry', { ns: 'common' })}
            onRetry={() => void balanceQuery.refetch()}
          />
        ) : balanceQuery.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">{tLeave('myLeave.empty')}</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {balanceQuery.data.map((row) => (
              <li key={row.leave_type} className="flex justify-between">
                <span>{tLeave(`type.${row.leave_type}`)}</span>
                <span>{row.balance}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <LeaveRequestDialog
        open={requestOpen}
        onOpenChange={setRequestOpen}
        staffProfileId={staffProfileId}
      />
    </div>
  );
}
