/**
 * [21.10.1] D18: the family-facing phone-first agenda — one guardian, one
 * child, that child's day. Section resolution is entirely server-side:
 * `useResolveRoutine({ student_id })` (D14, `GET /routines/resolve`) reads
 * the student's active enrolment itself (`ResolveRoutineService
 * .resolveStudentSection`) — this route never looks up or passes a
 * `section_id`.
 *
 * Multi-child switching reuses `fees.tsx`'s exact pattern: `?student=` in
 * the URL, `StudentPicker` for the switching UI, and `useMyStudents()` for
 * the linked list — not a second selector.
 */
import {
  EmptyState,
  ErrorState,
  RoutePending,
  RoutineAgenda,
  Skeleton,
  StudentPicker,
  type RoutineAgendaDay,
  type RoutineAgendaItem,
} from '@biddaloy/ui/components';
import {
  myStudentsQueryOptions,
  useCalendarEvents,
  useCalendarSettings,
  useMyStudents,
  useResolveRoutine,
  useRoutines,
  useRooms,
  useSubjects,
  useTeachers,
  usePeriodSlotLookup,
  type ResolvedSlot,
  type Routine,
  type Student,
} from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { createFileRoute } from '@tanstack/react-router';
import * as React from 'react';
import { z } from 'zod';

import { loadRouteNamespaces, swallowUnlessOffline } from '../../route-loaders';

const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
const AGENDA_WINDOW_DAYS = 7;

function isoOf(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`;
}

function todayIso(): string {
  return isoOf(new Date());
}

/** Same "rolling window from today" choice `my.tsx` makes, for the same
 * reason: "today first" (D18) needs no week-start convention to reorder. */
function agendaDates(): string[] {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Array.from({ length: AGENDA_WINDOW_DAYS }, (_, i) => {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    return isoOf(d);
  });
}

/** PARENT/STUDENT never see DRAFT or REVIEW slots — `resolveRoutine`
 * already returns nothing for them in either state — so a routine reads
 * as "not published yet" for a family unless it's actually PUBLISHED. */
function hasPublishableRoutine(routines: Routine[] | undefined): boolean {
  return (routines ?? []).some((r) => r.state === 'PUBLISHED');
}

const searchSchema = z.object({
  student: z.string().optional().catch(undefined),
});

export const Route = createFileRoute('/portal/routine')({
  validateSearch: searchSchema,
  loader: ({ context: { queryClient } }) =>
    Promise.all([
      queryClient.ensureQueryData(myStudentsQueryOptions()).catch(swallowUnlessOffline),
      loadRouteNamespaces('portal', 'routines', 'common'),
    ]),
  pendingComponent: PortalRoutinePending,
  component: PortalRoutine,
});

/** The same "class section · roll" meta line `fees.tsx`/`attendance.tsx`
 * render, from the same two keys. */
function useStudentMeta(): (student: Student) => string {
  const { t } = useTranslation('portal');
  return (student: Student) => {
    const className = student.class_section?.class?.name ?? null;
    return className === null
      ? t('children.metaNoClass', { roll: student.roll_number })
      : t('children.meta', {
          className,
          section: student.class_section?.section_name ?? '',
          roll: student.roll_number,
        });
  };
}

function PortalRoutine() {
  const { t } = useTranslation('portal');
  const { t: tRoutines } = useTranslation('routines');
  const search = Route.useSearch();
  const studentMeta = useStudentMeta();
  const dates = React.useMemo(agendaDates, []);
  const from = dates[0]!;
  const to = dates[dates.length - 1]!;

  const studentsQuery = useMyStudents();
  const students: Student[] = studentsQuery.data ?? [];
  const selected =
    students.find((student) => student.id === search.student) ?? students[0] ?? undefined;

  const routinesQuery = useRoutines();
  const resolveQuery = useResolveRoutine(
    selected ? { student_id: selected.id, from, to } : undefined,
  );
  const subjectsQuery = useSubjects({});
  const roomsQuery = useRooms();
  const teachersQuery = useTeachers({});
  const periodLookupQuery = usePeriodSlotLookup();
  const calendarSettingsQuery = useCalendarSettings();
  const calendarEventsQuery = useCalendarEvents({ from, to });

  if (studentsQuery.isPending) return <PortalRoutineSkeleton label={t('routine.loading')} />;

  if (studentsQuery.isError) {
    return (
      <ErrorState
        message={t('routine.error.message')}
        retryLabel={t('routine.error.retry')}
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

  // subjectsQuery and teachersQuery are excluded: PARENT/STUDENT get 403 on
  // both `/subjects` and `/teachers` server-side, so waiting on them would
  // permanently break this page for every family. Their `?? id` fallbacks
  // below cover the gap, though subject/teacher names still render as raw
  // ids for families until the server exposes them or the permission opens.
  const pending = [
    routinesQuery,
    resolveQuery,
    roomsQuery,
    periodLookupQuery,
    calendarSettingsQuery,
    calendarEventsQuery,
  ];

  if (pending.some((q) => q.isPending)) {
    return <PortalRoutineSkeleton label={t('routine.loading')} showPicker={students.length > 1} />;
  }

  if (pending.some((q) => q.isError)) {
    return (
      <ErrorState
        message={t('routine.error.message')}
        retryLabel={t('routine.error.retry')}
        onRetry={() => pending.forEach((q) => void q.refetch())}
      />
    );
  }

  if (!hasPublishableRoutine(routinesQuery.data)) {
    return (
      <div className="flex max-w-2xl flex-col gap-3">
        <h1 className="text-lg font-semibold">{t('routine.title')}</h1>
        {students.length > 1 && (
          <StudentPicker
            label={t('routine.pickerLabel')}
            items={students.map((student) => ({
              id: student.id,
              name: student.full_name,
              meta: studentMeta(student),
            }))}
            selectedId={selected.id}
            to="/portal/routine"
          />
        )}
        <p className="text-sm text-muted-foreground">{t('routine.noRoutineExplanation')}</p>
      </div>
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
  const periodLabel = (id: string) => {
    const entry = periodLookupQuery.data?.[id];
    return entry ? tRoutines('agenda.periodLabel', { sequence: entry.sequence }) : id;
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
      ? tRoutines('agenda.holidayReason', { name: holiday.name })
      : weeklyOffDays.has(weekday)
        ? tRoutines('agenda.weeklyOffReason')
        : undefined;

    const items: RoutineAgendaItem[] = (slotsByDate.get(date) ?? []).map((slot) => {
      const period = periodLookupQuery.data?.[slot.period_slot_id];
      return {
        slotId: slot.routine_slot_id,
        periodLabel: periodLabel(slot.period_slot_id),
        startsAt: period?.starts_at ?? '',
        endsAt: period?.ends_at ?? '',
        subjectLabel: subjectName(slot.subject_id),
        roomLabel: roomLabel(slot.room_id),
        cancelled: slot.cancelled,
        coveringForLabel: slot.substituted
          ? tRoutines('agenda.coveringForLabel', {
              name: (slot.covering_for_teacher_ids ?? []).map(teacherName).join(', '),
            })
          : undefined,
      };
    });

    return {
      date,
      weekdayLabel: tRoutines(`grid.weekday.${WEEKDAY_KEYS[weekday]}`),
      isToday: date === todayIso(),
      offReason,
      items,
    };
  });

  return (
    <div className="flex max-w-2xl flex-col gap-3">
      <h1 className="text-lg font-semibold">{t('routine.title')}</h1>
      {students.length > 1 && (
        <StudentPicker
          label={t('routine.pickerLabel')}
          items={students.map((student) => ({
            id: student.id,
            name: student.full_name,
            meta: studentMeta(student),
          }))}
          selectedId={selected.id}
          to="/portal/routine"
        />
      )}
      <PortalRoutineAgenda days={days} />
    </div>
  );
}

/** Isolated so the day/week-view selection state doesn't force the whole
 * route (loading/error/empty decisions above) to re-render on toggle. */
function PortalRoutineAgenda({ days }: { days: RoutineAgendaDay[] }) {
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

function PortalRoutineSkeleton({
  label,
  showPicker = false,
}: {
  label: string;
  showPicker?: boolean;
}) {
  return (
    <div className="flex max-w-2xl flex-col gap-3" aria-busy="true" aria-live="polite">
      <span className="sr-only">{label}</span>
      <Skeleton className="h-7 w-2/5" />
      {showPicker && <Skeleton className="h-12 w-full rounded-lg" />}
      <Skeleton className="h-9 w-full rounded-lg" />
      <Skeleton className="h-16 w-full rounded-lg" />
      <Skeleton className="h-16 w-full rounded-lg" />
    </div>
  );
}

function PortalRoutinePending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="list" label={t('routePending.label', { ns: 'nav' })} />;
}
