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
import { toast } from '@biddaloy/ui/components';
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
import { getActiveTenant } from '@biddaloy/ui/api';
import {
  RoutineGrid,
  cellKey,
  RoutePending,
  type RoutineGridCell,
} from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';
import { createFileRoute } from '@tanstack/react-router';
import * as React from 'react';
import { z } from 'zod';

import { loadRouteNamespaces } from '../../../route-loaders';

import { CellPicker, type CellPickerValue } from './-cell-picker';
import { ConflictList } from './-conflict-list';
import { FillAssistDialog } from './-fill-assist-dialog';
import { WorkloadPanel } from './-workload-panel';

const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

const searchSchema = z.object({
  classId: z.string().uuid().optional().catch(undefined),
});

export const Route = createFileRoute('/_staff/routines/$sectionId')({
  validateSearch: searchSchema,
  loader: () => loadRouteNamespaces('routines', 'common'),
  pendingComponent: RoutineBuilderPending,
  component: RoutineBuilderPage,
});

function RoutineBuilderPending() {
  const { t } = useTranslation('routines');
  return <RoutePending variant="form" label={t('routePending.label', { ns: 'nav' })} />;
}

interface ActiveCell {
  weekday: number;
  periodSlotId: string;
  initialFilter?: string;
}

function RoutineBuilderPage() {
  const { t } = useTranslation('routines');
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
  const [violations, setViolations] = React.useState<ConstraintViolation[]>([]);
  const [warnings, setWarnings] = React.useState<ConstraintWarning[]>([]);
  const [fillAssistOpen, setFillAssistOpen] = React.useState(false);

  if (!classId) {
    return (
      <p className="p-4 text-sm text-muted-foreground">{t('builder.noClassIdExplanation')}</p>
    );
  }

  if (sectionsQuery.isPending || routinesQuery.isPending) return null;

  if (!section) {
    return <p className="p-4 text-sm text-destructive">{t('builder.sectionNotFound')}</p>;
  }

  if (!section.class.shift_id) {
    return <p className="p-4 text-sm text-muted-foreground">{t('builder.noShiftExplanation')}</p>;
  }

  if (!routine) {
    return <p className="p-4 text-sm text-muted-foreground">{t('builder.noRoutineExplanation')}</p>;
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

  const sectionSlots = (slotsQuery.data ?? []).filter(
    (entry) => entry.slot.section_id === sectionId,
  );
  const cells: Record<string, RoutineGridCell> = {};
  for (const entry of sectionSlots) {
    cells[cellKey(entry.slot.weekday, entry.slot.period_slot_id)] = {
      slotId: entry.slot.id,
      subjectLabel:
        subjectsQuery.data?.data.find((subject) => subject.id === entry.slot.subject_id)
          ?.name_en ?? entry.slot.subject_id,
      teacherLabels: entry.teacher_ids.map(
        (id) => teachersQuery.data?.data.find((teacher) => teacher.id === id)?.user.full_name ?? id,
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
    const existing = activeCellSlot();
    const input = {
      section_id: sectionId,
      period_slot_id: activeCell.periodSlotId,
      weekday: activeCell.weekday,
      subject_id: value.subjectId,
      teacher_ids: value.teacherIds,
      recurrence: value.recurrence,
      recurrence_offset: value.recurrenceOffset,
      valid_from: existing?.slot.valid_from ?? todayIso(),
      valid_to: existing?.slot.valid_to ?? null,
    };
    const mutation = existing
      ? updateSlot.mutateAsync({ slotId: existing.slot.id, input })
      : createSlot.mutateAsync(input);

    mutation
      .then((result) => {
        setViolations([]);
        setWarnings(result.warnings);
        setActiveCell(null);
        toast.success(t('builder.savedToast'));
      })
      .catch((error) => {
        const found = conflictViolations(error);
        if (found) {
          setViolations(found);
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

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">
          {t('builder.title', {
            className: section.class.name,
            sectionName: section.section_name,
          })}
        </h1>
        <button
          type="button"
          className="h-9 rounded-md border border-border-subtle px-3 text-sm"
          onClick={() => setFillAssistOpen(true)}
        >
          {t('builder.fillAssistAction')}
        </button>
      </div>

      <ConflictList violations={violations} warnings={warnings} />

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

      <WorkloadPanel
        routineId={routine.id}
        maxPeriodsPerTeacherPerDay={settingsQuery.data?.routine?.maxPeriodsPerTeacherPerDay}
      />

      {activeCell && (
        <CellPicker
          open
          onOpenChange={(open) => !open && setActiveCell(null)}
          initialFilter={activeCell.initialFilter}
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
  );
}
