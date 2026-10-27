/**
 * [36.4] `/attendance/staff` — marks today's (or a picked date's) staff
 * attendance in one `PUT /staff-attendance/register` call, mirroring the
 * shape of `../register.tsx` (date picker + submit) but per-staff rather
 * than per-section-per-month.
 */
import { AttendanceStatus, Permission } from '@biddaloy/shared';
import {
  Button,
  DatePicker,
  EmptyState,
  ErrorState,
  Label,
  Skeleton,
  Textarea,
} from '@biddaloy/ui/components';
import {
  useHasPermission,
  useMarkStaffAttendance,
  useStaffAttendanceDay,
} from '@biddaloy/ui/hooks';
import { useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { PageContainer } from '@biddaloy/ui/shells';
import { parseDate, toIsoDate } from '@biddaloy/ui/utils';
import { createFileRoute, Link } from '@tanstack/react-router';
import { CalendarMinus, Save, UserCheck } from 'lucide-react';
import * as React from 'react';
import { z } from 'zod';

import { loadRouteNamespaces } from '../../../../route-loaders';

import {
  countStaffDraft,
  StaffAttendanceGrid,
  type StaffAttendanceDraft,
} from './-staff-attendance-grid';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

// `parseDate` throws on e.g. 2026-13-45; such a URL falls back to today.
function isRealDate(value: string): boolean {
  try {
    parseDate(value);
    return true;
  } catch {
    return false;
  }
}

const searchSchema = z.object({
  date: z
    .string()
    .regex(DATE_PATTERN)
    .refine(isRealDate)
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
  const regionConfig = useTenantRegionConfig();
  const navigate = Route.useNavigate();
  const search = Route.useSearch();
  const date = search.date ?? todayIso();

  const canMark = useHasPermission(Permission.STAFF_ATTENDANCE_MARK);
  // The roster comes from `GET /staff-attendance/register`, which returns every
  // staff member for an admin-level caller and only the caller's own row otherwise
  // (`GET /users` is admin-only, so it broke this page for every other role).
  const dayQuery = useStaffAttendanceDay(date);
  const staff = React.useMemo(() => dayQuery.data?.staff ?? [], [dayQuery.data]);

  // Saved marks come from the server; `draft` holds only this session's edits, so a
  // save sends just the changed rows and the refetched marks stay on screen.
  const saved = React.useMemo(
    () =>
      Object.fromEntries(
        staff.filter((row) => row.status).map((row) => [row.staff_profile_id, row.status]),
      ) as StaffAttendanceDraft,
    [staff],
  );

  const [reason, setReason] = React.useState('');
  const [reasonTooShort, setReasonTooShort] = React.useState(false);
  const [draft, setDraft] = React.useState<StaffAttendanceDraft>({});
  const markAttendance = useMarkStaffAttendance();

  // `draft` is plain component state, not tied to `date` — switching the
  // date via the picker keeps this same route component mounted, so
  // without this reset the previous day's marks would ride along and get
  // saved against the new date.
  React.useEffect(() => {
    setDraft({});
    setReason('');
    setReasonTooShort(false);
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
    const reasonRequired = dayQuery.data?.reason_required === true;
    if (reasonRequired && reason.trim().length < 3) {
      setReasonTooShort(true);
      return;
    }
    setReasonTooShort(false);
    markAttendance.mutate(
      { date, entries, ...(reasonRequired ? { reason: reason.trim() } : {}) },
      {
        onSuccess: () => {
          setDraft({});
          setReason('');
        },
      },
    );
  }

  // The server refused for a missing reason: show the same inline error.
  const reasonRefused =
    (markAttendance.error as { details?: { code?: string } } | null)?.details?.code ===
    'STAFF_ATTENDANCE_REASON_REQUIRED';
  const showReasonError = reasonTooShort || reasonRefused;
  const shown = React.useMemo(() => ({ ...saved, ...draft }), [saved, draft]);
  const unmarked = countStaffDraft(staff, shown).unmarked;

  return (
    <PageContainer>
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between md:gap-6">
        <div className="min-w-0">
          <h1 className="text-h1">{t('grid.title')}</h1>
          {!dayQuery.isPending && !dayQuery.isError && (
            <p className="mt-0.5 text-text-secondary">
              {t('grid.staffCount', { count: staff.length })}
            </p>
          )}
        </div>
        <div className="flex items-end gap-2">
          <div className="grid min-w-0 flex-1 gap-1.5 md:w-64 md:flex-none">
            <Label htmlFor="staff-attendance-date">{t('grid.dateLabel')}</Label>
            <DatePicker
              id="staff-attendance-date"
              aria-label={t('grid.dateLabel')}
              config={regionConfig}
              value={parseDate(date)}
              onValueChange={(next) =>
                next && void navigate({ search: (prev) => ({ ...prev, date: toIsoDate(next) }) })
              }
            />
          </div>
          <Button asChild variant="outline" className="shrink-0">
            <Link to="/attendance/staff/leave">
              <CalendarMinus aria-hidden="true" />
              {t('items.leave', { ns: 'nav' })}
            </Link>
          </Button>
        </div>
      </header>

      {dayQuery.isPending ? (
        <div aria-busy="true" aria-live="polite" className="space-y-6">
          <span className="sr-only">{t('grid.loading')}</span>
          <div className="overflow-hidden rounded-lg border border-border-subtle bg-surface shadow-e1">
            <Skeleton className="h-12 rounded-none border-b border-border-subtle" />
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-14 rounded-none border-b border-border-subtle" />
            ))}
          </div>
        </div>
      ) : dayQuery.isError ? (
        <ErrorState
          message={t('grid.loadError')}
          retryLabel={t('actions.retry', { ns: 'common' })}
          onRetry={() => void dayQuery.refetch()}
        />
      ) : staff.length === 0 ? (
        <EmptyState
          icon={<UserCheck />}
          title={t('grid.emptyTitle')}
          explanation={t('grid.emptyMessage')}
          action={{ label: t('grid.emptyAction'), onClick: () => void navigate({ to: '/staff' }) }}
        />
      ) : (
        <>
          <StaffAttendanceGrid
            staff={staff}
            draft={shown}
            onStatusChange={handleStatusChange}
            disabled={!canMark || markAttendance.isPending}
          />
          {canMark && (
            <div className="sticky bottom-16 z-20 flex flex-wrap items-center gap-3 rounded-lg border border-border-subtle bg-surface p-3 shadow-e2 md:bottom-0 md:px-5">
              {dayQuery.data?.reason_required && (
                <div className="grid w-full gap-1.5">
                  <Label htmlFor="staff-attendance-reason">{t('grid.reasonLabel')}</Label>
                  <Textarea
                    id="staff-attendance-reason"
                    value={reason}
                    minLength={3}
                    maxLength={280}
                    rows={2}
                    aria-describedby="staff-attendance-reason-help"
                    aria-invalid={showReasonError}
                    disabled={markAttendance.isPending}
                    onChange={(event) => setReason(event.target.value)}
                  />
                  <p id="staff-attendance-reason-help" className="text-caption text-text-secondary">
                    {t('grid.reasonHelp')}
                  </p>
                  {showReasonError && (
                    <p role="alert" className="text-caption text-destructive">
                      {t('grid.reasonTooShort')}
                    </p>
                  )}
                </div>
              )}
              {markAttendance.isError && !reasonRefused ? (
                <span role="alert" className="shrink-0 text-destructive">
                  {t('grid.errorMessage')}
                </span>
              ) : markAttendance.isSuccess ? (
                <span role="status" className="shrink-0 text-text-secondary">
                  {t('grid.saved')}
                </span>
              ) : (
                <span className="shrink-0 text-text-secondary">
                  {t('grid.unmarkedRemaining', { n: unmarked })}
                </span>
              )}
              <Button
                type="button"
                className="flex-1 md:ms-auto md:flex-none"
                loading={markAttendance.isPending}
                disabled={Object.keys(draft).length === 0}
                onClick={handleSubmit}
              >
                <Save aria-hidden="true" />
                {markAttendance.isPending ? t('grid.saving') : t('grid.submit')}
              </Button>
            </div>
          )}
        </>
      )}
    </PageContainer>
  );
}
