import {
  Card,
  EmptyState,
  ErrorState,
  RoutePending,
  Skeleton,
  StudentPicker,
} from '@biddaloy/ui/components';
import {
  calendarEventsQueryOptions,
  calendarSettingsQueryOptions,
  myStudentsQueryOptions,
  useCalendarSettings,
  useMyStudents,
  type Student,
} from '@biddaloy/ui/hooks';
import { RegionConfigProvider, useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatDate, parseServerDate } from '@biddaloy/ui/utils';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';
import { z } from 'zod';

import { AgendaList, type AgendaEvent } from '../../components/calendar/agenda-list';
import { MonthGrid, type MonthGridEvent } from '../../components/calendar/month-grid';
import { loadRouteNamespaces, swallowUnlessOffline } from '../../route-loaders';

/**
 * [17.5.2] Read-only family calendar — one guardian, their linked
 * children, the school year's events, filtered by whichever child is
 * selected. Same URL-param structure as `attendance.tsx`
 * (`?student=`, `?month=`, both real `Link`s so Back walks both), and
 * reuses `MonthGrid`/`AgendaList`/`EventTypeBadge` as-is from the staff
 * `/calendar` route ([17.4.2]) rather than forking them — grid on
 * desktop, agenda on narrow viewports, both always mounted with a
 * `hidden md:block` / `md:hidden` split (no JS viewport detection, no
 * view toggle: the portal case is read-only and never needs to see both
 * at once).
 *
 * No create/edit/delete/publish controls anywhere on this route — those
 * live only on the staff `/calendar` route, gated by `CALENDAR_MANAGE`.
 * Family visibility itself is role-gated server-side
 * (`FamilyCalendarEventDto`, #721) — the same "no `Permission` on the
 * nav item" case `attendance.tsx` documents for `/portal/attendance`.
 *
 * `class_id` filter follows the *selected* child's class
 * (`student.class_section.class_id`), so switching children refetches a
 * differently-scoped event list.
 */
const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

function currentMonthIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function shiftMonth(month: string, delta: number): string {
  const [yearStr, monthStr] = month.split('-');
  const year = Number(yearStr);
  const monthNum = Number(monthStr);
  const shifted = new Date(Date.UTC(year, monthNum - 1 + delta, 1));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Inclusive `from`/`to` range for `GET /calendar/events`, padded ±1 week
 * so leading/trailing days from neighbouring months (rendered by
 * `MonthGrid`'s 6x7 grid) still carry their events. Same shape as the
 * staff `/calendar` route's own `monthRange`. */
function monthRange(month: string): { from: string; to: string } {
  const [yearStr, monthStr] = month.split('-');
  const year = Number(yearStr);
  const monthNum = Number(monthStr);
  const from = new Date(Date.UTC(year, monthNum - 1, 1));
  from.setUTCDate(from.getUTCDate() - 7);
  const to = new Date(Date.UTC(year, monthNum, 0));
  to.setUTCDate(to.getUTCDate() + 7);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

function monthCaption(month: string, monthNames: string[]): string {
  const [yearStr, monthStr] = month.split('-');
  const monthNum = Number(monthStr);
  return `${monthNames[monthNum - 1] ?? monthStr} ${yearStr}`;
}

const WEEKDAY_KEYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const searchSchema = z.object({
  student: z.string().uuid().optional().catch(undefined),
  month: z
    .string()
    .regex(MONTH_PATTERN)
    .catch(() => currentMonthIso()),
});

export const Route = createFileRoute('/portal/calendar')({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => ({
    month: search.month ?? currentMonthIso(),
    student: search.student,
  }),
  loader: async ({ context: { queryClient }, deps }) => {
    const { from, to } = monthRange(deps.month);
    // Students resolve first — a family with none linked should never
    // issue the events request at all (mirrors `attendance.tsx`'s own
    // "no students, no attendance fetch" behaviour).
    const [students] = await Promise.all([
      queryClient.ensureQueryData(myStudentsQueryOptions()).catch(swallowUnlessOffline),
      queryClient.ensureQueryData(calendarSettingsQueryOptions()).catch(swallowUnlessOffline),
      loadRouteNamespaces('portal', 'common'),
    ]);
    if (students !== undefined && students.length > 0) {
      // Same selection rule the component uses (`deps.student` ??
      // first student), so the prefetch's cache key — including
      // `classId` — matches the component's query exactly. Otherwise
      // the prefetch warms a cache entry the component never reads.
      const selected = students.find((student) => student.id === deps.student) ?? students[0];
      const classId = selected?.class_section?.class_id;
      await queryClient
        .ensureQueryData(calendarEventsQueryOptions({ from, to, classId }))
        .catch(swallowUnlessOffline);
    }
  },
  pendingComponent: PortalCalendarPending,
  component: PortalCalendarRoute,
});

function PortalCalendarRoute() {
  return (
    <RegionConfigProvider>
      <PortalCalendar />
    </RegionConfigProvider>
  );
}

/** Twelve literal `t()` calls, not computed `t(\`attendanceGrid.months.${n}\`)`
 * — a computed key is invisible to `check-i18n-keys.mjs`, the same
 * reasoning `attendance.tsx`'s own `useMonthNames` documents. Reuses
 * `attendanceGrid.months.*` rather than a second copy, since this
 * route's month caption names the exact same month `attendance.tsx`'s
 * own month stepper does. */
function useMonthNames(): string[] {
  const { t } = useTranslation('portal');
  return [
    t('attendanceGrid.months.1'),
    t('attendanceGrid.months.2'),
    t('attendanceGrid.months.3'),
    t('attendanceGrid.months.4'),
    t('attendanceGrid.months.5'),
    t('attendanceGrid.months.6'),
    t('attendanceGrid.months.7'),
    t('attendanceGrid.months.8'),
    t('attendanceGrid.months.9'),
    t('attendanceGrid.months.10'),
    t('attendanceGrid.months.11'),
    t('attendanceGrid.months.12'),
  ];
}

/** The same "class section · roll" line `attendance.tsx`, `portal/index.tsx`
 * and `fees.tsx` render, from the same two keys. */
function useStudentMeta(): (student: Student) => string {
  const { t } = useTranslation('portal');
  return (student: Student) => {
    const className = student.class_section?.class?.name ?? null;
    return className === null
      ? t('children.metaNoClass', { roll: student.roll_number })
      : t('children.meta', {
          className,
          section: student.class_section?.section_name,
          roll: student.roll_number,
        });
  };
}

function PortalCalendar() {
  const { t } = useTranslation('portal');
  const config = useRegionConfig();
  const search = Route.useSearch();
  const monthNames = useMonthNames();
  const studentMeta = useStudentMeta();

  const studentsQuery = useMyStudents();
  const students: Student[] = studentsQuery.data ?? [];

  const selected = students.find((student) => student.id === search.student) ?? students[0];

  const month = search.month;
  const { from, to } = monthRange(month);
  const classId = selected?.class_section?.class_id;

  // `enabled` guards the fetch on `selected` (not built into
  // `useCalendarEvents`, unlike `useStudentAttendanceDays`'s own
  // `studentId`-driven guard) — a family with no linked students should
  // never issue this request at all.
  const eventsQuery = useQuery({
    ...calendarEventsQueryOptions({ from, to, classId }),
    enabled: selected !== undefined,
  });
  const settingsQuery = useCalendarSettings();

  if (studentsQuery.isPending) return <CalendarSkeleton label={t('calendar.loading')} />;

  if (studentsQuery.isError) {
    return (
      <ErrorState
        message={t('calendar.error.message')}
        retryLabel={t('calendar.error.retry')}
        onRetry={() => void studentsQuery.refetch()}
      />
    );
  }

  if (students.length === 0 || selected === undefined) {
    return (
      <EmptyState
        title={t('empty.title')}
        explanation={t('empty.explanation')}
        action={{ label: t('empty.action'), onClick: () => void studentsQuery.refetch() }}
      />
    );
  }

  if (eventsQuery.isPending || settingsQuery.isPending) {
    return <CalendarSkeleton label={t('calendar.loading')} showPicker={students.length > 1} />;
  }

  if (eventsQuery.isError || settingsQuery.isError) {
    return (
      <ErrorState
        message={t('calendar.error.message')}
        retryLabel={t('calendar.error.retry')}
        onRetry={() => {
          void eventsQuery.refetch();
          void settingsQuery.refetch();
        }}
      />
    );
  }

  const events = eventsQuery.data.data;
  const monthGridEvents: MonthGridEvent[] = events.map((event) => ({
    id: event.id,
    type: event.type,
    typeLabel: t(`calendar.types.${event.type}`),
    name: event.name,
    startDate: event.start_date,
    endDate: event.end_date,
  }));
  const agendaEvents: AgendaEvent[] = monthGridEvents;

  const previousMonth = shiftMonth(month, -1);
  const nextMonth = shiftMonth(month, 1);

  return (
    <div className="flex max-w-3xl flex-col gap-3">
      <h1 className="text-lg font-semibold tracking-tight">{t('calendar.title')}</h1>
      {students.length > 1 && (
        <StudentPicker
          label={t('calendar.pickerLabel')}
          items={students.map((student) => ({
            id: student.id,
            name: student.full_name,
            meta: studentMeta(student),
          }))}
          selectedId={selected.id}
          to="/portal/calendar"
        />
      )}
      <div className="flex items-center justify-between gap-2">
        <Link
          to="/portal/calendar"
          search={{ student: selected.id, month: previousMonth }}
          aria-label={t('calendar.previousMonth')}
          className="flex size-11 items-center justify-center rounded-md text-muted-foreground"
        >
          <ChevronLeftIcon className="size-5" aria-hidden="true" />
        </Link>
        <span className="text-sm font-semibold" aria-hidden="true">
          {monthCaption(month, monthNames)}
        </span>
        <Link
          to="/portal/calendar"
          search={{ student: selected.id, month: nextMonth }}
          aria-label={t('calendar.nextMonth')}
          className="flex size-11 items-center justify-center rounded-md text-muted-foreground"
        >
          <ChevronRightIcon className="size-5" aria-hidden="true" />
        </Link>
      </div>
      <Card className="p-3.5">
        <div className="hidden md:block">
          <MonthGrid
            month={month}
            firstDayOfWeek={settingsQuery.data.firstDayOfWeek}
            weeklyOffDays={settingsQuery.data.weeklyOffDays}
            events={monthGridEvents}
            weekdayLabels={WEEKDAY_KEYS.map((key) =>
              t(`calendar.weekdays.${key}`, { defaultValue: key }),
            )}
            moreLabel={(count) => t('calendar.moreEvents', { count: count })}
          />
        </div>
        <div className="md:hidden">
          <AgendaList
            events={agendaEvents}
            formatDayHeading={(day) => formatDate(parseServerDate(day), config)}
            emptyLabel={t('calendar.agendaEmpty')}
          />
        </div>
      </Card>
    </div>
  );
}

function CalendarSkeleton({
  label,
  showPicker = false,
}: {
  label: string;
  showPicker?: boolean;
}) {
  return (
    <div className="flex max-w-3xl flex-col gap-3" aria-busy="true" aria-live="polite">
      <span className="sr-only">{label}</span>
      <Skeleton className="h-7 w-2/5" />
      {showPicker && <Skeleton className="h-12 w-full rounded-lg" />}
      <Skeleton className="h-9 w-full rounded-lg" />
      <Skeleton className="h-96 w-full rounded-lg" />
    </div>
  );
}

function PortalCalendarPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="list" label={t('routePending.label', { ns: 'nav' })} />;
}
