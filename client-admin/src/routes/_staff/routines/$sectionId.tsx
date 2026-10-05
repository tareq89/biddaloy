/**
 * [21.8.1] The keyboard grid builder for one section's week. `?classId=`
 * (set by `index.tsx`'s `Link`) is how this page finds the section's
 * class — there is no `GET /classes/sections/:id` endpoint to fetch a
 * section standalone, so this reuses `useClassSections(classId)` the
 * same way `attendance/register.tsx` does, rather than adding a new
 * server route out of this ticket's territory. Opened by a direct URL
 * with no `classId` (bookmarked link, browser back), the page shows a
 * message to navigate from `/routines` instead of guessing.
 *
 * `RoutineSlotsService`'s `Routine` document is scoped to an academic
 * year, not a section — every section on that year shares one document,
 * and a slot's own `section_id` is what narrows it down. This page picks
 * the section's academic year's `PUBLISHED` routine if one exists,
 * otherwise its most-recently-created `DRAFT` (no routine-creation UI
 * exists yet in this codebase, out of this ticket's `## Files` list —
 * flagged in the PR description).
 */
import { getActiveTenant } from '@biddaloy/ui/api';
import {
  Card,
  EmptyState,
  RoutineGrid,
  routineCellKey,
  Skeleton,
  StatusBadge,
  toast,
  type RoutineGridCell,
} from '@biddaloy/ui/components';
import {
  useClassSections,
  useCalendarSettings,
  useCreateRoutineSlot,
  useDeleteRoutineSlot,
  usePeriodSlots,
  useRoutines,
  useRoutineSlots,
  useSchoolSettings,
  useSubjects,
  useTeachers,
  useUpdateRoutineSlot,
  useWorkload,
  conflictViolations,
  type ConstraintViolation,
  type ConstraintWarning,
} from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { DetailShell, PageContainer, PageHeader } from '@biddaloy/ui/shells';
import { formatNumber, formatTime, toIsoDate } from '@biddaloy/ui/utils';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { SendIcon, TableIcon, WandSparklesIcon } from 'lucide-react';
import * as React from 'react';
import { z } from 'zod';

import { loadRouteNamespaces } from '../../../route-loaders';

import { BuilderDayList } from './-builder-day-list';
import { CellPicker, type CellPickerValue } from './-cell-picker';
import { ConflictList } from './-conflict-list';
import { FillAssistDialog } from './-fill-assist-dialog';
import { subjectName } from './-subject-name';
import { WorkloadPanel } from './-workload-panel';

const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

const searchSchema = z.object({
  classId: z.string().uuid().optional().catch(undefined),
});

export const Route = createFileRoute('/_staff/routines/$sectionId')({
  validateSearch: searchSchema,
  loader: () => loadRouteNamespaces('routines', 'common'),
  component: RoutineBuilderPage,
});

interface ActiveCell {
  weekday: number;
  periodSlotId: string;
  initialFilter?: string;
}

function RoutineBuilderPage() {
  const { t, i18n } = useTranslation('routines');
  const config = useRegionConfig();
  const navigate = useNavigate();
  const { sectionId } = Route.useParams();
  const { classId } = Route.useSearch();
  const schoolId = getActiveTenant() ?? '';

  const sectionsQuery = useClassSections(classId);
  const section = sectionsQuery.data?.find((candidate) => candidate.id === sectionId);

  const routinesQuery = useRoutines();
  const routine =
    routinesQuery.data?.find(
      (candidate) =>
        candidate.academic_year_id === section?.class.academic_year_id &&
        candidate.state === 'PUBLISHED',
    ) ??
    routinesQuery.data
      ?.filter((candidate) => candidate.academic_year_id === section?.class.academic_year_id)
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0];

  const periodSlotsQuery = usePeriodSlots(section?.class.shift_id ?? undefined);
  const calendarSettingsQuery = useCalendarSettings();
  const settingsQuery = useSchoolSettings(schoolId);
  const slotsQuery = useRoutineSlots(routine?.id);
  const subjectsQuery = useSubjects({});
  const teachersQuery = useTeachers({});
  useWorkload(routine?.id); // warms the cache `WorkloadPanel` reads

  const createSlot = useCreateRoutineSlot(routine?.id ?? '');
  const updateSlot = useUpdateRoutineSlot(routine?.id ?? '');
  const deleteSlot = useDeleteRoutineSlot(routine?.id ?? '');

  const [activeCell, setActiveCell] = React.useState<ActiveCell | null>(null);
  // [1047] Identity of the cell whose picker is open right now, readable
  // from inside an already-in-flight save's `.then`/`.catch`. Each open
  // creates a fresh `ActiveCell` object, so the object itself is the
  // token: a response that comes back after the user closed the picker
  // (or moved to another cell) no longer matches, and is dropped rather
  // than showing the previous cell's conflict over the new one.
  const activeCellRef = React.useRef<ActiveCell | null>(activeCell);
  activeCellRef.current = activeCell;
  const [violations, setViolations] = React.useState<ConstraintViolation[]>([]);
  const [warnings, setWarnings] = React.useState<ConstraintWarning[]>([]);
  const [fillAssistOpen, setFillAssistOpen] = React.useState(false);

  const backToList = {
    label: t('builder.backToList'),
    onClick: () => void navigate({ to: '/routines', search: { classId } }),
  };
  const problem = (
    title: string,
    explanation: string,
    action: { label: string; onClick: () => void },
    known?: { name: string },
  ) => {
    const empty = (
      <EmptyState
        title={title}
        explanation={explanation}
        action={action}
        icon={<TableIcon aria-hidden="true" />}
      />
    );
    return known ? (
      <DetailShell name={known.name}>{empty}</DetailShell>
    ) : (
      <PageContainer>
        <PageHeader title={t('builder.backToList')} />
        {empty}
      </PageContainer>
    );
  };

  if (!classId) {
    return problem(t('builder.noClassIdTitle'), t('builder.noClassIdExplanation'), backToList);
  }

  if (sectionsQuery.isPending || routinesQuery.isPending) {
    return (
      <PageContainer>
        <div aria-busy="true" className="flex flex-col gap-4">
          <span className="sr-only">{t('builder.loading')}</span>
          <Skeleton className="h-8 w-1/3" />
          <Skeleton className="h-5 w-1/2" />
          {Array.from({ length: 6 }, (_, index) => (
            <Skeleton key={index} className="h-14 w-full" />
          ))}
        </div>
      </PageContainer>
    );
  }

  if (!section) {
    return problem(
      t('builder.sectionNotFound'),
      t('builder.sectionNotFoundExplanation'),
      backToList,
    );
  }

  const sectionTitle = t('builder.title', {
    className: section.class.name,
    sectionName: section.section_name,
  });

  if (!section.class.shift_id) {
    return problem(
      t('builder.noShiftTitle'),
      t('builder.noShiftExplanation'),
      {
        label: t('builder.openClass'),
        onClick: () => void navigate({ to: '/classes/$classId', params: { classId } }),
      },
      { name: sectionTitle },
    );
  }

  if (!routine) {
    return problem(
      t('builder.noRoutineTitle'),
      t('builder.noRoutineExplanation'),
      { label: t('builder.openReview'), onClick: () => void navigate({ to: '/routines/review' }) },
      { name: sectionTitle },
    );
  }

  const weekdays = [0, 1, 2, 3, 4, 5, 6].filter(
    (weekday) => !(calendarSettingsQuery.data?.weeklyOffDays ?? [5, 6]).includes(weekday),
  );
  const weekdayLabels = Object.fromEntries(
    weekdays.map((weekday) => [weekday, t(`grid.weekday.${WEEKDAY_KEYS[weekday]}`)]),
  );
  const periods = (periodSlotsQuery.data ?? []).map((slot) => ({
    id: slot.id,
    sequence: slot.sequence,
    kind: slot.kind,
    name: slot.name,
    starts_at: slot.starts_at,
    ends_at: slot.ends_at,
  }));

  // [21.8.1] `update()` closes an edited row rather than deleting it (D4),
  // so after one edit two rows can share the same weekday/period_slot_id —
  // one active, one superseded. Filtering to rows effective today keeps
  // the grid (and `activeCellSlot`/`handleClearCell` below, which both
  // read `sectionSlots`) pointed at the live row, not the historical one —
  // same predicate `greedy-fill.service.ts` already uses server-side.
  const today = toIsoDate(new Date());
  const sectionSlots = (slotsQuery.data ?? []).filter(
    (entry) =>
      entry.slot.section_id === sectionId &&
      entry.slot.valid_from <= today &&
      (entry.slot.valid_to === null || entry.slot.valid_to >= today),
  );
  const cells: Record<string, RoutineGridCell> = {};
  for (const entry of sectionSlots) {
    cells[routineCellKey(entry.slot.weekday, entry.slot.period_slot_id)] = {
      slotId: entry.slot.id,
      subjectLabel: subjectName(
        subjectsQuery.data?.data.find((subject) => subject.id === entry.slot.subject_id),
        i18n.language,
      ),
      teacherLabels: entry.teacher_ids.map(
        (id) =>
          teachersQuery.data?.data.find((teacher) => teacher.id === id)?.user.full_name ?? '—',
      ),
      recurrence: entry.slot.recurrence,
      hasViolation: false,
      hasWarning: entry.warnings.length > 0,
    };
  }

  function activeCellSlot(): (typeof sectionSlots)[number] | undefined {
    if (!activeCell) return undefined;
    return sectionSlots.find(
      (entry) =>
        entry.slot.weekday === activeCell.weekday &&
        entry.slot.period_slot_id === activeCell.periodSlotId,
    );
  }

  function handleSave(value: CellPickerValue) {
    if (!activeCell || !routine) return;
    const savingCell = activeCell;
    const existing = activeCellSlot();
    const input = {
      section_id: sectionId,
      period_slot_id: activeCell.periodSlotId,
      weekday: activeCell.weekday,
      subject_id: value.subjectId,
      teacher_ids: value.teacherIds,
      recurrence: value.recurrence,
      recurrence_offset: value.recurrenceOffset,
      valid_from: existing?.slot.valid_from ?? today,
      valid_to: existing?.slot.valid_to ?? null,
    };
    const mutation = existing
      ? updateSlot.mutateAsync({ slotId: existing.slot.id, input })
      : createSlot.mutateAsync(input);

    mutation
      .then((result) => {
        setWarnings(result.warnings);
        // The save landed either way — only the picker-bound state is
        // conditional on that picker still being the open one.
        if (activeCellRef.current === savingCell) {
          setViolations([]);
          setActiveCell(null);
        }
        toast.success(t('builder.savedToast'));
      })
      .catch((error) => {
        const found = conflictViolations(error);
        if (found) {
          if (activeCellRef.current === savingCell) setViolations(found);
          return;
        }
        toast.error(t('builder.saveErrorToast'));
      });
  }

  function handleClearCell(weekday: number, periodSlotId: string) {
    const entry = sectionSlots.find(
      (candidate) =>
        candidate.slot.weekday === weekday && candidate.slot.period_slot_id === periodSlotId,
    );
    if (!entry) return;
    deleteSlot.mutate(entry.slot.id, {
      onSuccess: () => setViolations([]),
    });
  }

  const activePeriod = activeCell
    ? periods.find((period) => period.id === activeCell.periodSlotId)
    : undefined;
  const filled = Object.keys(cells).length;
  const total = weekdays.length * periods.filter((period) => period.kind !== 'BREAK').length;
  const stateTone = { DRAFT: 'neutral', REVIEW: 'warning', PUBLISHED: 'success' } as const;

  return (
    <DetailShell
      name={sectionTitle}
      statusBadge={
        <StatusBadge
          tone={stateTone[routine.state]}
          label={t(`review.stateLabel.${routine.state}`)}
        />
      }
      facts={[
        {
          label: t('builder.studentsFact'),
          value: t('builder.studentsValue', {
            count: formatNumber(section.enrolled_count, config),
          }),
        },
        {
          label: t('builder.filledFact'),
          value: t('builder.filledValue', {
            filled: formatNumber(filled, config),
            total: formatNumber(total, config),
          }),
        },
      ]}
      actions={[
        {
          id: 'review',
          label: t('builder.reviewAction'),
          icon: <SendIcon />,
          priority: 'secondary',
          onClick: () => void navigate({ to: '/routines/review' }),
        },
        {
          id: 'fill',
          label: t('builder.fillAssistAction'),
          icon: <WandSparklesIcon />,
          priority: 'primary',
          onClick: () => setFillAssistOpen(true),
        },
      ]}
    >
      <div className="flex flex-col gap-6">
        {/* [1047] Violations render inside the still-open CellPicker instead —
          see that component's own `violations` prop doc. This page-level
          list is warnings only: those only arrive on a *successful* save,
          after the dialog has already closed. */}
        <ConflictList violations={[]} warnings={warnings} />

        <section className="space-y-3">
          <p className="hidden text-text-secondary md:block">{t('builder.keyboardHint')}</p>
          <div className="hidden md:block">
            <Card padded={false} className="overflow-hidden">
              <RoutineGrid
                weekdays={weekdays}
                weekdayLabels={weekdayLabels}
                periods={periods}
                cells={cells}
                onActivateCell={(weekday, periodSlotId) => setActiveCell({ weekday, periodSlotId })}
                onClearCell={handleClearCell}
                onTypeAhead={(weekday, periodSlotId, char) =>
                  setActiveCell({ weekday, periodSlotId, initialFilter: char })
                }
              />
            </Card>
          </div>
          <div className="md:hidden">
            <BuilderDayList
              weekdays={weekdays}
              weekdayLabels={weekdayLabels}
              periods={periods}
              cells={cells}
              onActivateCell={(weekday, periodSlotId) => setActiveCell({ weekday, periodSlotId })}
            />
          </div>
        </section>

        <WorkloadPanel
          routineId={routine.id}
          maxPeriodsPerTeacherPerDay={settingsQuery.data?.routine?.maxPeriodsPerTeacherPerDay}
        />

        {activeCell && (
          <CellPicker
            open
            onOpenChange={(open) => {
              if (!open) {
                setActiveCell(null);
                setViolations([]);
              }
            }}
            initialFilter={activeCell.initialFilter}
            {...(activePeriod
              ? {
                  dayLabel: weekdayLabels[activeCell.weekday],
                  periodLabel: t('agenda.periodLabel', { sequence: activePeriod.sequence }),
                  timeLabel: formatTime(activePeriod.starts_at, config),
                }
              : {})}
            initialValue={
              activeCellSlot()
                ? {
                    subjectId: activeCellSlot()!.slot.subject_id,
                    teacherIds: activeCellSlot()!.teacher_ids,
                    recurrence: activeCellSlot()!.slot.recurrence,
                    recurrenceOffset: activeCellSlot()!.slot.recurrence_offset,
                  }
                : undefined
            }
            onSave={handleSave}
            saving={createSlot.isPending || updateSlot.isPending}
            violations={violations}
          />
        )}

        <FillAssistDialog
          open={fillAssistOpen}
          onOpenChange={setFillAssistOpen}
          routineId={routine.id}
          sectionId={sectionId}
          weekdayLabels={weekdayLabels}
          onDone={() => setViolations([])}
        />
      </div>
    </DetailShell>
  );
}
