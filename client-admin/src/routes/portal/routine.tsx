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
 *
 * One day at a time: seven kit tabs from today, the selected day's periods
 * in a list under them. The subject name comes from the resolved slot
 * itself (`subject_name_en` / `subject_name_bn`) — `/subjects` and
 * `/teachers` both 403 for a family, so this page never asks for them.
 */
import {
  Card,
  EmptyState,
  ErrorState,
  RoutePending,
  Skeleton,
  StatusBadge,
  StudentPicker,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@biddaloy/ui/components';
import {
  myStudentsQueryOptions,
  useCalendarEvents,
  useCalendarSettings,
  useMyStudents,
  useResolveRoutine,
  useRoutines,
  useRooms,
  usePeriodSlotLookup,
  type ResolvedSlot,
  type Routine,
  type Student,
} from '@biddaloy/ui/hooks';
import {
  RegionConfigProvider,
  useRegionConfig,
  useTranslation,
  type RegionConfig,
} from '@biddaloy/ui/i18n';
import { PageContainer, PageHeader } from '@biddaloy/ui/shells';
import {
  formatDate,
  formatNumber,
  formatTime,
  formatWeekday,
  parseServerDate,
  toIsoDate,
} from '@biddaloy/ui/utils';
import { createFileRoute } from '@tanstack/react-router';
import { CalendarClockIcon } from 'lucide-react';
import * as React from 'react';
import { z } from 'zod';

import { loadRouteNamespaces, swallowUnlessOffline } from '../../route-loaders';

const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
const AGENDA_WINDOW_DAYS = 7;

/** Same "rolling window from today" choice `my.tsx` makes, for the same
 * reason: "today first" (D18) needs no week-start convention to reorder. */
function agendaDates(): string[] {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Array.from({ length: AGENDA_WINDOW_DAYS }, (_, i) => {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    return toIsoDate(d);
  });
}

/** PARENT/STUDENT never see DRAFT or REVIEW slots — `resolveRoutine`
 * already returns nothing for them in either state — so a routine reads
 * as "not published yet" for a family unless it's actually PUBLISHED for
 * the selected child's own year. `GET /academic-years` 403s for
 * PARENT/STUDENT, so unlike the staff routes this can't ask the server
 * which year is current — the selected student's own class year
 * (`GET /students/mine` already returns `class_section.class`) is the
 * closest family-readable stand-in, same as `resolveRoutine`'s own
 * enrolment-derived year lookup does server-side. */
function hasPublishableRoutine(
  routines: Routine[] | undefined,
  yearId: string | undefined,
): boolean {
  return (routines ?? []).some((r) => r.state === 'PUBLISHED' && r.academic_year_id === yearId);
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
  component: PortalRoutineRoute,
});

function PortalRoutineRoute() {
  return (
    <RegionConfigProvider>
      <PortalRoutine />
    </RegionConfigProvider>
  );
}

/** The same "class section · roll" meta line `fees.tsx`/`attendance.tsx`
 * render, from the same two keys. */
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
          section: student.class_section?.section_name ?? '',
          roll,
        });
  };
}

interface RoutineItem {
  slotId: string;
  title: string;
  meta: string;
  startsAt: string;
  endsAt: string;
  cancelled: boolean;
  substituted: boolean;
}

interface RoutineDay {
  date: string;
  weekdayLabel: string;
  isToday: boolean;
  offReason: string | undefined;
  items: RoutineItem[];
}

function PortalRoutine() {
  const { t } = useTranslation('portal');
  const { t: tRoutines } = useTranslation('routines');
  const config = useRegionConfig();
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
  // No `useSubjects` / `useTeachers`: both 403 for PARENT/STUDENT and the
  // failure fires the global "no permission" toast on every load.
  const roomsQuery = useRooms();
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
      <PageContainer size="narrow">
        <PageHeader title={t('routine.title')} />
        <EmptyState
          title={t('empty.title')}
          explanation={t('empty.explanation')}
          action={{ label: t('empty.action'), onClick: () => void studentsQuery.refetch() }}
        />
      </PageContainer>
    );
  }

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

  const header = (
    <>
      <PageHeader
        title={t('routine.title')}
        subtitle={`${selected.full_name} · ${studentMeta(selected)}`}
      />
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
    </>
  );

  if (!hasPublishableRoutine(routinesQuery.data, selected.class_section?.class?.academic_year_id)) {
    return (
      <PageContainer size="narrow">
        {header}
        <EmptyState
          icon={<CalendarClockIcon />}
          title={t('routine.noRoutineTitle')}
          explanation={t('routine.noRoutineExplanation')}
        />
      </PageContainer>
    );
  }

  const isBangla = config.locale.startsWith('bn');
  // The server's own subject name, bn/en with the other as fallback. Never
  // an id: no name means the period label stands in as the title.
  const subjectLabel = (slot: ResolvedSlot): string | null =>
    (isBangla
      ? slot.subject_name_bn || slot.subject_name_en
      : slot.subject_name_en || slot.subject_name_bn) || null;
  const roomLabel = (id: string | null) => {
    if (!id) return null;
    const room = roomsQuery.data?.data.find((r) => r.id === id);
    if (!room) return null;
    return room.building ? `${room.building} ${room.room_no}` : room.room_no;
  };
  const periodLabel = (id: string) => {
    const entry = periodLookupQuery.data?.[id];
    return entry
      ? tRoutines('agenda.periodLabel', { sequence: formatNumber(entry.sequence, config) })
      : '';
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

  const todayIso = toIsoDate(new Date());
  const days: RoutineDay[] = dates.map((date) => {
    const weekday = new Date(`${date}T00:00:00`).getDay();
    const holiday = holidayFor(date);
    const offReason = holiday
      ? tRoutines('agenda.holidayReason', { name: holiday.name })
      : weeklyOffDays.has(weekday)
        ? tRoutines('agenda.weeklyOffReason')
        : undefined;

    const items: RoutineItem[] = (slotsByDate.get(date) ?? []).map((slot) => {
      const period = periodLookupQuery.data?.[slot.period_slot_id];
      const subject = subjectLabel(slot);
      const periodText = periodLabel(slot.period_slot_id);
      return {
        slotId: slot.routine_slot_id,
        title: subject ?? periodText,
        meta: [subject ? periodText : null, roomLabel(slot.room_id)].filter(Boolean).join(' · '),
        startsAt: period?.starts_at ?? '',
        endsAt: period?.ends_at ?? '',
        cancelled: slot.cancelled,
        substituted: slot.substituted,
      };
    });

    return {
      date,
      weekdayLabel: tRoutines(`grid.weekday.${WEEKDAY_KEYS[weekday]}`),
      isToday: date === todayIso,
      offReason,
      items,
    };
  });

  return (
    <PageContainer size="narrow">
      {header}
      <PortalRoutineDays key={selected.id} days={days} config={config} />
    </PageContainer>
  );
}

/** Isolated so the selected-day state resets with the student (`key`) and
 * does not re-render the loading / error decisions above. */
function PortalRoutineDays({ days, config }: { days: RoutineDay[]; config: RegionConfig }) {
  const { t } = useTranslation('portal');
  const { t: tRoutines } = useTranslation('routines');
  const { t: tCommon } = useTranslation('common');
  const [selectedDate, setSelectedDate] = React.useState(days[0]?.date ?? '');

  return (
    <Card className="overflow-hidden p-0">
      <Tabs value={selectedDate} onValueChange={setSelectedDate} className="gap-0">
        <TabsList variant="line" aria-label={tRoutines('agenda.daySwitcherLabel')}>
          {days.map((day) => (
            <TabsTrigger key={day.date} value={day.date} className="h-11 flex-none px-3 md:h-10">
              {day.isToday
                ? tCommon('date.today')
                : `${day.weekdayLabel} ${formatNumber(parseServerDate(day.date).getDate(), config)}`}
            </TabsTrigger>
          ))}
        </TabsList>
        {days.map((day) => (
          <TabsContent key={day.date} value={day.date} className="p-4 md:p-5">
            <h2 className="text-h2">
              {formatWeekday(day.date, config)}, {formatDate(day.date, config)}
            </h2>
            {!day.offReason && (
              <p className="text-text-secondary">
                {t('routine.periodCount', { count: day.items.length })}
              </p>
            )}
            {day.offReason ? (
              <p className="mt-3 border-t border-border-subtle pt-3 text-text-secondary">
                {day.offReason}
              </p>
            ) : day.items.length === 0 ? (
              <p className="mt-3 border-t border-border-subtle pt-3 text-text-secondary">
                {tRoutines('agenda.emptyDay')}
              </p>
            ) : (
              <ul className="mt-3 divide-y divide-border-subtle border-t border-border-subtle">
                {day.items.map((item) => (
                  <li
                    key={item.slotId}
                    className={`flex items-start gap-3 py-3 ${item.cancelled ? 'text-text-secondary' : ''}`}
                  >
                    <div className="w-24 shrink-0 tabular-nums md:w-32">
                      <p className="font-medium">{formatTime(item.startsAt, config)}</p>
                      <p className="text-caption text-text-secondary">
                        {t('routine.until', { time: formatTime(item.endsAt, config) })}
                      </p>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className={`font-medium ${item.cancelled ? 'line-through' : ''}`}>
                        {item.title}
                      </p>
                      {item.meta && <p className="text-caption text-text-secondary">{item.meta}</p>}
                    </div>
                    {item.cancelled ? (
                      <StatusBadge tone="danger" label={tRoutines('agenda.cancelledLabel')} />
                    ) : item.substituted ? (
                      <StatusBadge tone="warning" label={t('routine.substitute')} />
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </TabsContent>
        ))}
      </Tabs>
    </Card>
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
    <div className="flex flex-col gap-3" aria-busy="true" aria-live="polite">
      <span className="sr-only">{label}</span>
      <Skeleton className="h-8 w-2/5" />
      {showPicker && <Skeleton className="h-12 w-full rounded-lg" />}
      <Skeleton className="h-11 w-full rounded-lg" />
      <Skeleton className="h-14 w-full rounded-lg" />
      <Skeleton className="h-14 w-full rounded-lg" />
      <Skeleton className="h-14 w-full rounded-lg" />
    </div>
  );
}

function PortalRoutinePending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="list" label={t('routePending.label', { ns: 'nav' })} />;
}
