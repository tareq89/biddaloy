import {
  DayPanel,
  EmptyState,
  ErrorState,
  MonthGrid,
  type MonthGridEvent,
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
import { PageContainer, PageHeader } from '@biddaloy/ui/shells';
import { formatNumber, toIsoDate } from '@biddaloy/ui/utils';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import * as React from 'react';
import { z } from 'zod';

import { loadRouteNamespaces, swallowUnlessOffline } from '../../route-loaders';

/**
 * [17.5.2] Read-only family calendar — one guardian, their linked
 * children, the school year's events, filtered by whichever child is
 * selected. Same URL-param structure as `attendance.tsx`
 * (`?student=`, `?month=`, both real `Link`s so Back walks both), and
 * reuses `MonthGrid`/`AgendaList`/`EventTypeBadge` as-is from the staff
 * `/calendar` route ([17.4.2]) rather than forking them — the month grid
 * on every width (chips on desktop, dots on phone) with the selected
 * day's events in a `DayPanel` beside / under it (D26). The grid's own
 * header drives `?month=`.
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

/** The same "class section · roll" line `attendance.tsx`, `portal/index.tsx`
 * and `fees.tsx` render, from the same two keys. */
function useStudentMeta(): (student: Student) => string {
  const { t } = useTranslation('portal');
  const config = useRegionConfig();
  return (student: Student) => {
    const className = student.class_section?.class?.name ?? null;
    const roll = formatNumber(student.roll_number, config);
    return className === null
      ? t('children.metaNoClass', { roll })
      : t('children.meta', {
          className,
          section: student.class_section?.section_name,
          roll,
        });
  };
}

function PortalCalendar() {
  const { t } = useTranslation('portal');
  const { t: tNav } = useTranslation('nav');
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const studentMeta = useStudentMeta();
  // A day is a passing look, not a place: component state, keyed to the
  // student and month it was clicked in so changing either resets it.
  const [picked, setPicked] = React.useState<{ key: string; date: string } | null>(null);

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
      <PageContainer>
        <PageHeader title={tNav('items.portalCalendar')} />
        <EmptyState
          title={t('empty.title')}
          explanation={t('empty.explanation')}
          action={{ label: t('empty.action'), onClick: () => void studentsQuery.refetch() }}
        />
      </PageContainer>
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

  const pickedKey = `${selected.id}:${month}`;
  const selectedDate =
    picked?.key === pickedKey
      ? picked.date
      : month === currentMonthIso()
        ? toIsoDate(new Date())
        : `${month}-01`;
  // ISO strings compare correctly as text.
  const eventsOn = (date: string) =>
    monthGridEvents.filter((e) => e.startDate <= date && (e.endDate ?? e.startDate) >= date);

  return (
    <PageContainer>
      <PageHeader
        title={tNav('items.portalCalendar')}
        subtitle={`${selected.full_name} · ${studentMeta(selected)}`}
      />
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
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:gap-6">
        <div className="min-w-0 flex-1">
          <MonthGrid
            month={month}
            today={toIsoDate(new Date())}
            selectedDate={selectedDate}
            // `?month=` is rewritten (not client state) so Back still walks
            // month changes.
            onMonthChange={(next) =>
              void navigate({ search: { student: selected.id, month: next } })
            }
            onDayClick={(date) => setPicked({ key: pickedKey, date })}
            firstDayOfWeek={settingsQuery.data.firstDayOfWeek}
            weeklyOffDays={settingsQuery.data.weeklyOffDays}
            events={monthGridEvents}
            weekdayLabels={WEEKDAY_KEYS.map((key) =>
              t(`calendar.weekdays.${key}`, { defaultValue: key }),
            )}
            moreLabel={(count) => t('calendar.moreEvents', { count: count })}
          />
        </div>
        <DayPanel date={selectedDate} events={eventsOn(selectedDate)} />
      </div>
    </PageContainer>
  );
}

function CalendarSkeleton({ label, showPicker = false }: { label: string; showPicker?: boolean }) {
  return (
    <div className="flex flex-col gap-3" aria-busy="true" aria-live="polite">
      <span className="sr-only">{label}</span>
      <Skeleton className="h-8 w-2/5" />
      {showPicker && <Skeleton className="h-12 w-full rounded-lg" />}
      <Skeleton className="h-96 w-full rounded-lg" />
    </div>
  );
}

function PortalCalendarPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="list" label={t('routePending.label', { ns: 'nav' })} />;
}
