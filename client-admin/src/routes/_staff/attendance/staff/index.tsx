/**
 * [36.4] `/attendance/staff` — marks today's (or a picked date's) staff
 * attendance in one `PUT /staff-attendance/register` call, mirroring the
 * shape of `../register.tsx` (date picker + submit) but per-staff rather
 * than per-section-per-month.
 */
import { AttendanceStatus, Permission } from '@biddaloy/shared';
import { Button, EmptyState, ErrorState, Skeleton } from '@biddaloy/ui/components';
import { useHasPermission, useMarkStaffAttendance, useUsers } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { createFileRoute, Link } from '@tanstack/react-router';
import * as React from 'react';
import { z } from 'zod';

import { loadRouteNamespaces } from '../../../../route-loaders';

import { StaffAttendanceGrid, type StaffAttendanceDraft } from './-staff-attendance-grid';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

const searchSchema = z.object({
  date: z
    .string()
    .regex(DATE_PATTERN)
    .optional()
    .catch(() => undefined),
});

export const Route = createFileRoute('/_staff/attendance/staff/')({
  validateSearch: searchSchema,
  loader: () => loadRouteNamespaces('staffAttendance', 'attendance', 'staff', 'common'),
  component: StaffAttendancePage,
});

function StaffAttendancePage() {
  const { t } = useTranslation('staffAttendance');
  const navigate = Route.useNavigate();
  const search = Route.useSearch();
  const date = search.date ?? todayIso();

  const canMark = useHasPermission(Permission.STAFF_ATTENDANCE_MARK);
  // [36.4] `useUsers` (`GET /users`) now returns `staff_profile_id` per
  // row (see this ticket's plan comment) — reused rather than a second
  // staff-list hook. A generous limit stands in for pagination: staff
  // rosters are small enough (dozens, not thousands) that one page over
  // every school this ships to is the lazy-correct call; revisit with
  // real pagination if a tenant's staff count ever approaches it.
  const usersQuery = useUsers({ limit: 200 });
  const staff = React.useMemo(
    () => (usersQuery.data?.data ?? []).filter((user) => user.staff_profile_id != null),
    [usersQuery.data],
  );

  const [draft, setDraft] = React.useState<StaffAttendanceDraft>({});
  const markAttendance = useMarkStaffAttendance();

  // `draft` is plain component state, not tied to `date` — switching the
  // date via the picker keeps this same route component mounted, so
  // without this reset the previous day's marks would ride along and get
  // saved against the new date.
  React.useEffect(() => {
    setDraft({});
    markAttendance.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only on date change, not every markAttendance identity change
  }, [date]);

  function handleStatusChange(staffProfileId: string, status: AttendanceStatus) {
    setDraft((prev) => ({ ...prev, [staffProfileId]: status }));
  }

  function handleSubmit() {
    const entries = Object.entries(draft)
      .filter((entry): entry is [string, AttendanceStatus] => entry[1] !== null)
      .map(([staff_profile_id, status]) => ({ staff_profile_id, status }));
    if (entries.length === 0) return;
    markAttendance.mutate(
      { date, entries },
      {
        onSuccess: () => setDraft({}),
      },
    );
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-lg font-semibold">{t('grid.title')}</h1>
        <label className="flex flex-col gap-1 text-sm">
          {t('grid.dateLabel')}
          <input
            type="date"
            className="h-8 rounded-md border border-input bg-card px-2.5 text-sm"
            value={date}
            onChange={(event) =>
              void navigate({ search: (prev) => ({ ...prev, date: event.target.value }) })
            }
          />
        </label>
      </div>

      {usersQuery.isPending ? (
        <div aria-busy="true" aria-live="polite" className="flex flex-col gap-2">
          <span className="sr-only">{t('grid.loading')}</span>
          <Skeleton className="h-64 w-full" />
        </div>
      ) : usersQuery.isError ? (
        <ErrorState
          message={t('grid.errorMessage')}
          retryLabel={t('actions.retry', { ns: 'common' })}
          onRetry={() => void usersQuery.refetch()}
        />
      ) : staff.length === 0 ? (
        <EmptyState
          title={t('grid.emptyTitle')}
          explanation={t('grid.emptyMessage')}
          action={{ label: t('grid.emptyAction'), onClick: () => void navigate({ to: '/staff' }) }}
        />
      ) : (
        <>
          <StaffAttendanceGrid
            staff={staff}
            draft={draft}
            onStatusChange={handleStatusChange}
            disabled={!canMark || markAttendance.isPending}
          />
          {canMark && (
            <div className="flex flex-col items-end gap-2">
              {markAttendance.isError && (
                <p role="alert" className="text-sm text-destructive">
                  {t('grid.errorMessage')}
                </p>
              )}
              {markAttendance.isSuccess && (
                <p role="status" className="text-sm text-muted-foreground">
                  {t('grid.saved')}
                </p>
              )}
              <Button
                type="button"
                loading={markAttendance.isPending}
                disabled={Object.keys(draft).length === 0}
                onClick={handleSubmit}
              >
                {markAttendance.isPending ? t('grid.saving') : t('grid.submit')}
              </Button>
            </div>
          )}
        </>
      )}
      <Link to="/attendance/staff/leave" className="self-start text-sm text-primary underline">
        {t('items.leave', { ns: 'nav' })}
      </Link>
    </div>
  );
}
