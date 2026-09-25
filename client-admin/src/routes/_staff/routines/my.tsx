/**
 * [21.10.1] D18: a teacher's own phone-first agenda — their own periods
 * plus whatever they are covering, marked. Every dated fact (recurrence,
 * effective dating, weekly-off/holiday exclusion, substitutions) comes
 * from `useResolveRoutine` (D14, `GET /routines/resolve`) — this route
 * only resolves display labels (subject/room/section/teacher names) and
 * builds the rolling 7-day window `RoutineAgenda` renders.
 *
 * "No published routine" is decided the same way `review.tsx` decides it
 * — no non-DRAFT `Routine` row exists for the tenant's current academic
 * year — rather than re-deriving it from an empty `resolveRoutine`
 * response, which is also empty on an ordinary holiday.
 */
import {
  ErrorState,
  RoutePending,
  RoutineAgenda,
  Skeleton,
  type RoutineAgendaDay,
  type RoutineAgendaItem,
} from '@biddaloy/ui/components';
import {
  useAcademicYears,
  useCalendarEvents,
  useCalendarSettings,
  useCurrentUserId,
  useResolveRoutine,
  useRoutines,
  useRooms,
  useSectionLookup,
  useSubjects,
  useTeachers,
  usePeriodSlotLookup,
  type ResolvedSlot,
  type Routine,
} from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { createFileRoute } from '@tanstack/react-router';
import * as React from 'react';

import { loadRouteNamespaces } from '../../../route-loaders';

const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
const AGENDA_WINDOW_DAYS = 7;

function todayIso(): string {
  const now = new Date();
  return isoOf(now);
}

function isoOf(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`;
}

/** A rolling window starting today, not a calendar week — "today first"
 * (D18) is simplest as "today plus the next six days" rather than
 * re-deriving the tenant's week-start convention just to reorder it. */
function agendaDates(): string[] {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Array.from({ length: AGENDA_WINDOW_DAYS }, (_, i) => {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    return isoOf(d);
  });
}

/** A `DRAFT` routine is builder-only and invisible to a teacher, same
 * rule `review.tsx` applies once scoped to the current academic year —
 * `Routine`'s unique `(tenant_id, academic_year_id)` index means at most
 * one routine can match once scoped, so no PUBLISHED/REVIEW ranking is
 * needed on top. */
function pickVisibleRoutine(
  routines: Routine[] | undefined,
  currentYearId: string | undefined,
): Routine | undefined {
  return (routines ?? []).find((r) => r.academic_year_id === currentYearId && r.state !== 'DRAFT');
}

export const Route = createFileRoute('/_staff/routines/my')({
  loader: () => loadRouteNamespaces('routines', 'common'),
  pendingComponent: MyRoutinePending,
  component: MyRoutinePage,
});

function MyRoutinePage() {
  const { t } = useTranslation('routines');
  const currentUserId = useCurrentUserId();
  const dates = React.useMemo(agendaDates, []);
  const from = dates[0]!;
  const to = dates[dates.length - 1]!;

  const academicYearsQuery = useAcademicYears({});
  const currentYearId = academicYearsQuery.data?.data.find((year) => year.is_current)?.id;
  const routinesQuery = useRoutines();
  const routine = pickVisibleRoutine(routinesQuery.data, currentYearId);

  const teachersQuery = useTeachers({});
  const ownTeacherQuery = useTeachers(
    currentUserId ? { user_id: currentUserId, limit: 1 } : { limit: 1 },
  );
  const ownTeacher = ownTeacherQuery.data?.data.find(
    (teacher) => teacher.user.id === currentUserId,
  );

  const resolveQuery = useResolveRoutine(
    ownTeacher ? { teacher_id: ownTeacher.id, from, to } : undefined,
  );
  const subjectsQuery = useSubjects({});
  const roomsQuery = useRooms();
  const sectionLookupQuery = useSectionLookup();
  const periodLookupQuery = usePeriodSlotLookup();
  const calendarSettingsQuery = useCalendarSettings();
  const calendarEventsQuery = useCalendarEvents({ from, to });

  if (routinesQuery.isPending || ownTeacherQuery.isPending || academicYearsQuery.isPending) {
    return <MyRoutineSkeleton label={t('myRoutine.loading')} />;
  }

  if (routinesQuery.isError || ownTeacherQuery.isError || academicYearsQuery.isError) {
    return (
      <ErrorState
        message={t('myRoutine.error.message')}
        retryLabel={t('myRoutine.error.retry')}
        onRetry={() => {
          void routinesQuery.refetch();
          void ownTeacherQuery.refetch();
          void academicYearsQuery.refetch();
        }}
      />
    );
  }

  if (!ownTeacher) {
    return (
      <p className="p-4 text-sm text-muted-foreground">{t('myRoutine.notATeacherExplanation')}</p>
    );
  }

  if (!routine) {
    return (
      <p className="p-4 text-sm text-muted-foreground">{t('myRoutine.noRoutineExplanation')}</p>
    );
  }

  if (
    resolveQuery.isPending ||
    subjectsQuery.isPending ||
    roomsQuery.isPending ||
    sectionLookupQuery.isPending ||
    periodLookupQuery.isPending ||
    calendarSettingsQuery.isPending ||
    calendarEventsQuery.isPending
  ) {
    return <MyRoutineSkeleton label={t('myRoutine.loading')} />;
  }

  if (
    resolveQuery.isError ||
    subjectsQuery.isError ||
    roomsQuery.isError ||
    sectionLookupQuery.isError ||
    periodLookupQuery.isError ||
    calendarSettingsQuery.isError ||
    calendarEventsQuery.isError
  ) {
    return (
      <ErrorState
        message={t('myRoutine.error.message')}
        retryLabel={t('myRoutine.error.retry')}
        onRetry={() => {
          void resolveQuery.refetch();
          void subjectsQuery.refetch();
          void roomsQuery.refetch();
          void sectionLookupQuery.refetch();
          void periodLookupQuery.refetch();
          void calendarSettingsQuery.refetch();
          void calendarEventsQuery.refetch();
        }}
      />
    );
  }

  const subjectName = (id: string) =>
    subjectsQuery.data?.data.find((subject) => subject.id === id)?.name_en ?? id;
  const roomLabel = (id: string | null) => {
    if (!id) return null;
    const room = roomsQuery.data?.data.find((r) => r.id === id);
    if (!room) return null;
    return room.building ? `${room.building} ${room.room_no}` : room.room_no;
  };
  const teacherName = (id: string) =>
    teachersQuery.data?.data.find((teacher) => teacher.id === id)?.user.full_name ?? id;
  const sectionLabel = (id: string) => {
    const entry = sectionLookupQuery.data?.[id];
    return entry ? `${entry.className} ${entry.sectionName}` : id;
  };
  const periodLabel = (id: string) => {
    const entry = periodLookupQuery.data?.[id];
    return entry ? t('agenda.periodLabel', { sequence: entry.sequence }) : id;
  };
  const weeklyOffDays = new Set(calendarSettingsQuery.data?.weeklyOffDays ?? []);
  const holidayFor = (date: string) =>
    (calendarEventsQuery.data?.data ?? []).find(
      (event) =>
        event.counts_as_working_day === false && event.start_date <= date && event.end_date >= date,
    );

  const slotsByDate = new Map<string, ResolvedSlot[]>();
  for (const slot of resolveQuery.data ?? []) {
    const list = slotsByDate.get(slot.date) ?? [];
    list.push(slot);
    slotsByDate.set(slot.date, list);
  }

  const days: RoutineAgendaDay[] = dates.map((date) => {
    const weekday = new Date(`${date}T00:00:00`).getDay();
    const holiday = holidayFor(date);
    const offReason = holiday
      ? t('agenda.holidayReason', { name: holiday.name })
      : weeklyOffDays.has(weekday)
        ? t('agenda.weeklyOffReason')
        : undefined;

    const items: RoutineAgendaItem[] = (slotsByDate.get(date) ?? []).map((slot) => {
      const period = periodLookupQuery.data?.[slot.period_slot_id];
      return {
        slotId: slot.routine_slot_id,
        periodLabel: periodLabel(slot.period_slot_id),
        startsAt: period?.starts_at ?? '',
        endsAt: period?.ends_at ?? '',
        sectionLabel: sectionLabel(slot.section_id),
        subjectLabel: subjectName(slot.subject_id),
        roomLabel: roomLabel(slot.room_id),
        cancelled: slot.cancelled,
        coveringForLabel: slot.substituted
          ? t('agenda.coveringForLabel', {
              name: (slot.covering_for_teacher_ids ?? []).map(teacherName).join(', '),
            })
          : undefined,
      };
    });

    return {
      date,
      weekdayLabel: t(`grid.weekday.${WEEKDAY_KEYS[weekday]}`),
      isToday: date === todayIso(),
      offReason,
      items,
    };
  });

  return (
    <div className="flex max-w-2xl flex-col gap-3 p-4">
      <h1 className="text-lg font-semibold">{t('myRoutine.title')}</h1>
      <MyRoutineAgenda days={days} />
    </div>
  );
}

/** Isolated so the day/week-view selection state doesn't force the whole
 * page (skeleton/error decisions above) to re-render on every toggle. */
function MyRoutineAgenda({ days }: { days: RoutineAgendaDay[] }) {
  const [selectedDate, setSelectedDate] = React.useState(days[0]?.date ?? '');
  const [weekView, setWeekView] = React.useState(false);
  return (
    <RoutineAgenda
      days={days}
      selectedDate={selectedDate}
      onSelectDate={setSelectedDate}
      weekView={weekView}
      onToggleWeekView={setWeekView}
    />
  );
}

function MyRoutineSkeleton({ label }: { label: string }) {
  return (
    <div className="flex max-w-2xl flex-col gap-3 p-4" aria-busy="true" aria-live="polite">
      <span className="sr-only">{label}</span>
      <Skeleton className="h-7 w-2/5" />
      <Skeleton className="h-9 w-full rounded-lg" />
      <Skeleton className="h-16 w-full rounded-lg" />
      <Skeleton className="h-16 w-full rounded-lg" />
    </div>
  );
}

function MyRoutinePending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="list" label={t('routePending.label', { ns: 'nav' })} />;
}
