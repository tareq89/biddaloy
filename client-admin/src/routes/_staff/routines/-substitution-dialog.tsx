/**
 * [21.9.1] D12: records a cover or a cancellation for one slot on one
 * date, without touching `routine_slots`. Picking the slot is a
 * class -> section -> weekly-slot cascade (same shape `index.tsx` uses
 * for the grid builder's own class/section picker) because there is no
 * "all sections" or "all slots" endpoint to search across instead.
 *
 * `SubstitutionsService.assertSlotOccursOn` (server) is the only
 * authority on whether a date is a real occurrence of the slot — this
 * dialog never re-derives that rule client-side. A 422 comes back with
 * the server's own message (`"Routine slot "<id>" does not occur on
 * <date>"`) and that `error.message` is shown verbatim, not replaced
 * with an invented client-side validation string.
 */
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Input, Textarea, toast } from '@biddaloy/ui/components';
import {
  useClasses,
  useClassSections,
  useRecordSubstitution,
  useRoutines,
  useRoutineSlots,
  useTeachers,
  type Routine,
} from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

export interface SubstitutionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}

function currentRoutineForYear(routines: Routine[] | undefined, academicYearId: string | undefined) {
  if (!routines || !academicYearId) return undefined;
  const forYear = routines.filter((routine) => routine.academic_year_id === academicYearId);
  return (
    forYear.find((routine) => routine.state === 'PUBLISHED') ??
    [...forYear].sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0]
  );
}

export function SubstitutionDialog({ open, onOpenChange, onDone }: SubstitutionDialogProps) {
  const { t } = useTranslation('routines');
  const recordSubstitution = useRecordSubstitution();

  const [classId, setClassId] = React.useState('');
  const [sectionId, setSectionId] = React.useState('');
  const [slotId, setSlotId] = React.useState('');
  const [date, setDate] = React.useState('');
  const [isCancelled, setIsCancelled] = React.useState(false);
  const [substituteTeacherId, setSubstituteTeacherId] = React.useState('');
  const [reason, setReason] = React.useState('');
  const [serverError, setServerError] = React.useState<string | null>(null);

  const classesQuery = useClasses();
  const sectionsQuery = useClassSections(classId || undefined);
  const section = sectionsQuery.data?.find((candidate) => candidate.id === sectionId);
  const routinesQuery = useRoutines();
  const routine = currentRoutineForYear(routinesQuery.data, section?.class.academic_year_id);
  const slotsQuery = useRoutineSlots(routine?.id);
  const teachersQuery = useTeachers({});

  const sectionSlots = (slotsQuery.data ?? []).filter((entry) => entry.slot.section_id === sectionId);

  React.useEffect(() => {
    if (!open) {
      setClassId('');
      setSectionId('');
      setSlotId('');
      setDate('');
      setIsCancelled(false);
      setSubstituteTeacherId('');
      setReason('');
      setServerError(null);
    }
  }, [open]);

  function handleSubmit() {
    if (!slotId || !date) return;
    setServerError(null);
    recordSubstitution.mutate(
      {
        routine_slot_id: slotId,
        date,
        is_cancelled: isCancelled,
        substitute_teacher_id: isCancelled ? null : substituteTeacherId || null,
        reason: reason.trim() || null,
      },
      {
        onSuccess: () => {
          toast.success(t('substitutionDialog.savedToast'));
          onDone();
          onOpenChange(false);
        },
        onError: (error) => {
          setServerError(error instanceof Error ? error.message : t('substitutionDialog.errorToast'));
        },
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('substitutionDialog.title')}</DialogTitle>
          <DialogDescription>{t('substitutionDialog.description')}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            {t('substitutionDialog.classLabel')}
            <select
              className="h-9 rounded-md border border-input bg-card px-2.5 text-sm"
              value={classId}
              onChange={(event) => {
                setClassId(event.target.value);
                setSectionId('');
                setSlotId('');
              }}
            >
              <option value="">{t('substitutionDialog.selectClass')}</option>
              {(classesQuery.data?.data ?? []).map((klass) => (
                <option key={klass.id} value={klass.id}>
                  {klass.name}
                </option>
              ))}
            </select>
          </label>

          {classId && (
            <label className="flex flex-col gap-1 text-sm">
              {t('substitutionDialog.sectionLabel')}
              <select
                className="h-9 rounded-md border border-input bg-card px-2.5 text-sm"
                value={sectionId}
                onChange={(event) => {
                  setSectionId(event.target.value);
                  setSlotId('');
                }}
              >
                <option value="">{t('substitutionDialog.selectSection')}</option>
                {(sectionsQuery.data ?? []).map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.section_name}
                  </option>
                ))}
              </select>
            </label>
          )}

          {sectionId && (
            <label className="flex flex-col gap-1 text-sm">
              {t('substitutionDialog.slotLabel')}
              <select
                className="h-9 rounded-md border border-input bg-card px-2.5 text-sm"
                value={slotId}
                onChange={(event) => setSlotId(event.target.value)}
              >
                <option value="">{t('substitutionDialog.selectSlot')}</option>
                {sectionSlots.map((entry) => (
                  <option key={entry.slot.id} value={entry.slot.id}>
                    {t(`grid.weekday.${WEEKDAY_KEYS[entry.slot.weekday]}`)}
                  </option>
                ))}
              </select>
            </label>
          )}

          <label className="flex flex-col gap-1 text-sm">
            {t('substitutionDialog.dateLabel')}
            <Input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          </label>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={isCancelled}
              onChange={(event) => setIsCancelled(event.target.checked)}
            />
            {t('substitutionDialog.cancelledLabel')}
          </label>

          {!isCancelled && (
            <label className="flex flex-col gap-1 text-sm">
              {t('substitutionDialog.substituteTeacherLabel')}
              <select
                className="h-9 rounded-md border border-input bg-card px-2.5 text-sm"
                value={substituteTeacherId}
                onChange={(event) => setSubstituteTeacherId(event.target.value)}
              >
                <option value="">{t('substitutionDialog.selectTeacher')}</option>
                {(teachersQuery.data?.data ?? []).map((teacher) => (
                  <option key={teacher.id} value={teacher.id}>
                    {teacher.user.full_name}
                  </option>
                ))}
              </select>
            </label>
          )}

          <label className="flex flex-col gap-1 text-sm">
            {t('substitutionDialog.reasonLabel')}
            <Textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={280}
            />
          </label>

          {serverError && (
            <p role="alert" className="text-sm text-destructive">
              {serverError}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            {t('substitutionDialog.cancel')}
          </Button>
          <Button
            type="button"
            disabled={!slotId || !date}
            loading={recordSubstitution.isPending}
            onClick={handleSubmit}
          >
            {t('substitutionDialog.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
