/**
 * [21.10.1] D18 / [66.3.01] D11: a teacher's phone-first "today" page —
 * each period's planned lesson, reported taught / partly / not taught.
 * Dated facts for the next days (recurrence, weekly-off/holiday exclusion,
 * substitutions) come from `useResolveRoutine` (D14); the day being marked
 * comes from `useMyLessonDeliveries`.
 *
 * "No published routine" is decided the same way `review.tsx` decides it
 * — no non-DRAFT `Routine` row exists for the tenant's current academic
 * year — rather than re-deriving it from an empty `resolveRoutine`
 * response, which is also empty on an ordinary holiday.
 */
import { Permission } from '@biddaloy/shared';
import { EmptyState, ErrorState, RoutePending, Skeleton } from '@biddaloy/ui/components';
import {
  useAcademicYears,
  useActiveTenant,
  useCurrentUserId,
  useHasPermission,
  useMarkTodayAllTaught,
  useMyLessonDeliveries,
  useResolveRoutine,
  useRoutines,
  useRooms,
  useSchoolSettings,
  useSectionLookup,
  useSubjects,
  useTeachers,
  usePeriodSlotLookup,
  type ResolvedSlot,
  type Routine,
} from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { PageContainer, PageHeader } from '@biddaloy/ui/shells';
import { toIsoDate } from '@biddaloy/ui/utils';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { CalendarClockIcon, UserRoundXIcon } from 'lucide-react';
import * as React from 'react';
import { z } from 'zod';

import { loadRouteNamespaces } from '../../../route-loaders';

import { clampMarkingDate, addDays } from './-marking/dates';
import { DaySummaryCard } from './-marking/day-summary-card';
import { DueBanner } from './-marking/due-banner';
import { NextDays, type NextDay } from './-marking/next-days';
import { PeriodCard } from './-marking/period-card';

const searchSchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .catch(undefined),
});

const NEXT_DAYS = 6;

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
  validateSearch: searchSchema,
  loader: () => loadRouteNamespaces('routines', 'common'),
  pendingComponent: MyRoutinePending,
  component: MyRoutinePage,
});

function MyRoutinePage() {
  const { t, i18n } = useTranslation('routines');
  const navigate = useNavigate();
  const canManage = useHasPermission(Permission.ROUTINE_MANAGE);
  const currentUserId = useCurrentUserId();
  const search = Route.useSearch();
  const today = React.useMemo(() => toIsoDate(new Date()), []);
  const date = clampMarkingDate(search.date, today); // D29
  const isToday = date === today;
  const tomorrow = addDays(today, 1);
  const lastNextDay = addDays(today, NEXT_DAYS);

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
    ownTeacher
      ? { teacher_id: ownTeacher.id, from: date < tomorrow ? date : tomorrow, to: lastNextDay }
      : undefined,
  );
  const subjectsQuery = useSubjects({});
  const roomsQuery = useRooms();
  const sectionLookupQuery = useSectionLookup();
  const periodLookupQuery = usePeriodSlotLookup();
  const deliveriesQuery = useMyLessonDeliveries(date);
  const markAll = useMarkTodayAllTaught();
  // `MaskedTenantSettings` (ui/hooks/school-settings.ts) does not list `studyPlans` yet.
  const studyPlans = (
    useSchoolSettings(useActiveTenant() ?? '').data as
      { studyPlans?: { statusDeadline?: string } } | undefined
  )?.studyPlans;
  const canMakePlan = useHasPermission(Permission.SYLLABUS_MANAGE);

  const frame = (body: React.ReactNode) => (
    <PageContainer size="narrow">
      <PageHeader title={t('myRoutine.title')} subtitle={t('myRoutine.subtitle')} />
      {body}
    </PageContainer>
  );

  if (routinesQuery.isPending || ownTeacherQuery.isPending || academicYearsQuery.isPending) {
    return frame(<MyRoutineSkeleton label={t('myRoutine.loading')} />);
  }

  if (routinesQuery.isError || ownTeacherQuery.isError || academicYearsQuery.isError) {
    return frame(
      <ErrorState
        message={t('myRoutine.error.message')}
        retryLabel={t('myRoutine.error.retry')}
        onRetry={() => {
          void routinesQuery.refetch();
          void ownTeacherQuery.refetch();
          void academicYearsQuery.refetch();
        }}
      />,
    );
  }

  if (!ownTeacher) {
    return frame(
      <EmptyState
        icon={<UserRoundXIcon aria-hidden="true" />}
        title={t('myRoutine.notATeacherTitle')}
        explanation={t('myRoutine.notATeacherExplanation')}
        {...(canManage
          ? {
              action: {
                label: t('myRoutine.openClassRoutine'),
                onClick: () => void navigate({ to: '/routines' }),
              },
            }
          : {})}
      />,
    );
  }

  if (!routine) {
    return frame(
      <EmptyState
        icon={<CalendarClockIcon aria-hidden="true" />}
        title={t('myRoutine.noRoutineTitle')}
        explanation={t('myRoutine.noRoutineExplanation')}
      />,
    );
  }

  if (
    resolveQuery.isPending ||
    subjectsQuery.isPending ||
    roomsQuery.isPending ||
    sectionLookupQuery.isPending ||
    periodLookupQuery.isPending ||
    deliveriesQuery.isPending
  ) {
    return frame(<MyRoutineSkeleton label={t('myRoutine.loading')} />);
  }

  if (
    resolveQuery.isError ||
    subjectsQuery.isError ||
    roomsQuery.isError ||
    sectionLookupQuery.isError ||
    periodLookupQuery.isError ||
    deliveriesQuery.isError
  ) {
    return frame(
      <ErrorState
        message={t('myRoutine.error.message')}
        retryLabel={t('myRoutine.error.retry')}
        onRetry={() => {
          void resolveQuery.refetch();
          void subjectsQuery.refetch();
          void roomsQuery.refetch();
          void sectionLookupQuery.refetch();
          void periodLookupQuery.refetch();
          void deliveriesQuery.refetch();
        }}
      />,
    );
  }

  const subjectLabel = (subject: { name_en: string | null; name_bn: string | null }) =>
    i18n.language.startsWith('bn') && subject.name_bn ? subject.name_bn : (subject.name_en ?? '—');
  const roomLabel = (id: string | null) => {
    if (!id) return null;
    const room = roomsQuery.data?.data.find((r) => r.id === id);
    if (!room) return null;
    return room.building ? `${room.building} ${room.room_no}` : room.room_no;
  };
  const teacherName = (id: string) =>
    teachersQuery.data?.data.find((teacher) => teacher.id === id)?.user.full_name ?? '—';
  const sectionLabel = (id: string, fallback: string) => {
    const entry = sectionLookupQuery.data?.[id];
    return entry ? `${entry.className} – ${entry.sectionName}` : fallback;
  };

  const slots = resolveQuery.data ?? [];
  const day = deliveriesQuery.data;
  // Next days: only days with periods (weekly-off / holidays are already absent).
  const byDate = new Map<string, ResolvedSlot[]>();
  for (const slot of slots) {
    if (slot.date <= today || slot.cancelled) continue;
    byDate.set(slot.date, [...(byDate.get(slot.date) ?? []), slot]);
  }
  const nextDays: NextDay[] = [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([d, list]) => {
      const first = [...list].sort(
        (x, y) =>
          (periodLookupQuery.data?.[x.period_slot_id]?.sequence ?? 0) -
          (periodLookupQuery.data?.[y.period_slot_id]?.sequence ?? 0),
      )[0]!;
      return {
        date: d,
        periodCount: list.length,
        firstSection: sectionLabel(first.section_id, '—'),
      };
    });

  return frame(
    <div className="flex flex-col gap-4">
      {isToday && (
        <DueBanner
          due={day.due}
          today={today}
          onReport={(d) => void navigate({ to: '/routines/my', search: { date: d } })}
        />
      )}
      <DaySummaryCard
        date={date}
        isToday={isToday}
        periods={day.periods}
        statusDeadline={studyPlans?.statusDeadline ?? '18:00'}
        bulkPending={markAll.isPending}
        bulkFailed={markAll.isError}
        onBulk={() => markAll.mutate()}
        onBackToToday={() => void navigate({ to: '/routines/my', search: {} })}
      />
      {day.periods.length === 0 ? (
        <p className="rounded-lg border border-border-subtle bg-surface p-4 text-text-secondary">
          {t('agenda.emptyDay')}
        </p>
      ) : (
        day.periods.map((period) => {
          const slot = slots.find(
            (s) => s.routine_slot_id === period.routine_slot_id && s.date === date,
          );
          return (
            <PeriodCard
              key={period.routine_slot_id}
              period={period}
              date={date}
              sectionLabel={sectionLabel(period.section.id, period.section.name)}
              subjectLabel={subjectLabel(period.subject)}
              roomLabel={roomLabel(slot?.room_id ?? null)}
              coveringLabel={
                period.substituting
                  ? t('agenda.coveringForLabel', {
                      name: (slot?.covering_for_teacher_ids ?? []).map(teacherName).join(', '),
                    })
                  : undefined
              }
              canMakePlan={canMakePlan}
            />
          );
        })
      )}
      <NextDays days={nextDays} subjectLabel={subjectLabel} />
    </div>,
  );
}

function MyRoutineSkeleton({ label }: { label: string }) {
  return (
    <div className="flex flex-col gap-3" aria-busy="true" aria-live="polite">
      <span className="sr-only">{label}</span>
      <Skeleton className="h-9 w-full rounded-lg" />
      <div className="flex flex-col gap-3 rounded-lg border border-border-subtle bg-surface p-4">
        <Skeleton className="h-3 w-1/3" />
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-14 w-full" />
        ))}
      </div>
    </div>
  );
}

function MyRoutinePending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="list" label={t('routePending.label', { ns: 'nav' })} />;
}
