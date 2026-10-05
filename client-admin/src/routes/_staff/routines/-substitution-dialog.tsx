/**
 * [21.9.1] D12: records a cover or a cancellation for one slot on one
 * date, without touching `routine_slots`. [31.4] The picker is date ->
 * class and section -> a period that happens on that date's weekday, built
 * from the current year's routine (there is no "all slots" endpoint to
 * search across instead).
 *
 * `SubstitutionsService.assertSlotOccursOn` (server) stays the only
 * authority on whether a date is a real occurrence of the slot (a period
 * can run every other week or once a month) — this dialog only narrows the
 * list by weekday and never re-derives that rule. A 422 comes back in the
 * server's English; it is translated here (`notOnDateError`), never shown
 * verbatim.
 */
import { ApiError } from '@biddaloy/ui/api';
import {
  Button,
  Checkbox,
  DatePicker,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
  toast,
} from '@biddaloy/ui/components';
import {
  useAcademicYears,
  usePeriodSlotLookup,
  useRecordSubstitution,
  useRoutines,
  useRoutineSlots,
  useSectionLookup,
  useSubjects,
  useTeachers,
  type RoutineSlotWithWarnings,
} from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatNumber, formatTime, formatWeekday, toIsoDate } from '@biddaloy/ui/utils';
import { CircleAlertIcon } from 'lucide-react';
import * as React from 'react';

import { subjectName } from './-subject-name';

export interface SubstitutionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}

/** The current academic year's routine slots, by id. Shared by the dialog
 * and the log page, which joins each record to its period through it.
 * ponytail: current-year routine only; older records show "—" — include
 * `routine_slot` in `SubstitutionsService.list` if that matters. */
export function useCurrentRoutineSlots() {
  const academicYearsQuery = useAcademicYears({});
  const currentYearId = academicYearsQuery.data?.data.find((year) => year.is_current)?.id;
  const routinesQuery = useRoutines();
  const forYear = (routinesQuery.data ?? []).filter(
    (candidate) => candidate.academic_year_id === currentYearId,
  );
  // Same pick as `$sectionId.tsx`: the published routine, else the newest.
  const routine =
    forYear.find((candidate) => candidate.state === 'PUBLISHED') ??
    [...forYear].sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0];
  const slotsQuery = useRoutineSlots(routine?.id);
  const slots = slotsQuery.data;
  const slotsById = React.useMemo(
    () =>
      new Map<string, RoutineSlotWithWarnings>(
        (slots ?? []).map((entry) => [entry.slot.id, entry]),
      ),
    [slots],
  );
  return {
    routine,
    slots: slots ?? [],
    slotsById,
    isPending: academicYearsQuery.isPending || routinesQuery.isPending || slotsQuery.isPending,
  };
}

export function SubstitutionDialog({ open, onOpenChange, onDone }: SubstitutionDialogProps) {
  const { t, i18n } = useTranslation('routines');
  const config = useRegionConfig();
  const recordSubstitution = useRecordSubstitution();

  const [date, setDate] = React.useState<Date | undefined>(() => new Date());
  const [sectionId, setSectionId] = React.useState('');
  const [slotId, setSlotId] = React.useState('');
  const [isCancelled, setIsCancelled] = React.useState(false);
  const [substituteTeacherId, setSubstituteTeacherId] = React.useState('');
  const [reason, setReason] = React.useState('');
  const [errorKey, setErrorKey] = React.useState<'notOnDateError' | 'errorToast' | null>(null);

  const { routine, slots, slotsById } = useCurrentRoutineSlots();
  const sectionLookup = useSectionLookup();
  const periodLookup = usePeriodSlotLookup();
  const subjectsQuery = useSubjects({});
  const teachersQuery = useTeachers({});

  const sectionLabel = (id: string) => {
    const entry = sectionLookup.data?.[id];
    return entry
      ? t('substitutionsPage.sectionName', {
          className: entry.className,
          sectionName: entry.sectionName,
        })
      : '—';
  };
  const teacherName = (id: string) =>
    teachersQuery.data?.data.find((teacher) => teacher.id === id)?.user.full_name ?? '—';

  const sectionOptions = [...new Set(slots.map((entry) => entry.slot.section_id))]
    .map((id) => [id, sectionLabel(id)] as const)
    .sort((a, b) => a[1].localeCompare(b[1]));

  const sequenceOf = (entry: RoutineSlotWithWarnings) =>
    periodLookup.data?.[entry.slot.period_slot_id]?.sequence ?? 0;
  const slotOptions = date
    ? slots
        .filter(
          (entry) => entry.slot.section_id === sectionId && entry.slot.weekday === date.getDay(),
        )
        .sort((a, b) => sequenceOf(a) - sequenceOf(b))
    : [];
  const chosenSlot = slotsById.get(slotId);
  const substituteOptions = (teachersQuery.data?.data ?? []).filter(
    (teacher) => !chosenSlot?.teacher_ids.includes(teacher.id),
  );

  React.useEffect(() => {
    if (!open) {
      setDate(new Date());
      setSectionId('');
      setSlotId('');
      setIsCancelled(false);
      setSubstituteTeacherId('');
      setReason('');
      setErrorKey(null);
    }
  }, [open]);

  const canSave = Boolean(slotId && date && (isCancelled || substituteTeacherId));

  function handleSubmit() {
    if (!canSave || !date) return;
    setErrorKey(null);
    recordSubstitution.mutate(
      {
        routine_slot_id: slotId,
        date: toIsoDate(date),
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
        onError: (error) =>
          setErrorKey(
            error instanceof ApiError && error.statusCode === 422 ? 'notOnDateError' : 'errorToast',
          ),
      },
    );
  }

  const slotHelp = !date
    ? t('substitutionDialog.pickDateFirst')
    : !routine
      ? t('substitutionDialog.noRoutine')
      : sectionId && slotOptions.length === 0
        ? t('substitutionDialog.noSlotsOnDay', { weekday: formatWeekday(date, config) })
        : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>{t('substitutionDialog.title')}</DialogTitle>
          <DialogDescription>{t('substitutionDialog.description')}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <Label htmlFor="substitution-date">{t('substitutionDialog.dateLabel')}</Label>
            <DatePicker
              id="substitution-date"
              aria-label={t('substitutionDialog.dateLabel')}
              config={config}
              value={date}
              onValueChange={(next) => {
                setDate(next);
                setSlotId('');
              }}
            />
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="substitution-section">{t('substitutionDialog.sectionLabel')}</Label>
            <Select
              value={sectionId}
              onValueChange={(value) => {
                setSectionId(value);
                setSlotId('');
              }}
            >
              <SelectTrigger id="substitution-section" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {sectionOptions.map(([id, label]) => (
                  <SelectItem key={id} value={id}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="substitution-slot">{t('substitutionDialog.slotLabel')}</Label>
            <Select value={slotId} onValueChange={setSlotId}>
              <SelectTrigger id="substitution-slot" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {slotOptions.map((entry) => {
                  const period = periodLookup.data?.[entry.slot.period_slot_id];
                  return (
                    <SelectItem key={entry.slot.id} value={entry.slot.id}>
                      {t('substitutionDialog.slotOption', {
                        period: period
                          ? t('agenda.periodLabel', {
                              sequence: formatNumber(period.sequence, config),
                            })
                          : '—',
                        time: period ? formatTime(period.starts_at, config) : '—',
                        subject: subjectName(
                          subjectsQuery.data?.data.find(
                            (subject) => subject.id === entry.slot.subject_id,
                          ),
                          i18n.language,
                        ),
                        teachers: entry.teacher_ids.map(teacherName).join(', ') || '—',
                      })}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
            {slotHelp && <p className="text-caption text-text-secondary">{slotHelp}</p>}
          </div>

          <div className="flex min-h-11 items-center gap-3 md:min-h-8">
            <Checkbox
              id="substitution-cancelled"
              checked={isCancelled}
              onCheckedChange={(checked) => setIsCancelled(checked === true)}
            />
            <Label
              htmlFor="substitution-cancelled"
              className="min-h-11 flex-1 items-center md:min-h-8"
            >
              {t('substitutionDialog.cancelledLabel')}
            </Label>
          </div>

          {!isCancelled && (
            <div className="flex flex-col gap-1">
              <Label htmlFor="substitution-teacher">
                {t('substitutionDialog.substituteTeacherLabel')}
              </Label>
              <Select value={substituteTeacherId} onValueChange={setSubstituteTeacherId}>
                <SelectTrigger id="substitution-teacher" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {substituteOptions.map((teacher) => (
                    <SelectItem key={teacher.id} value={teacher.id}>
                      {teacher.user.full_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="flex flex-col gap-1">
            <Label htmlFor="substitution-reason">{t('substitutionDialog.reasonLabel')}</Label>
            <Textarea
              id="substitution-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={280}
            />
          </div>

          {errorKey && (
            <p role="alert" className="flex items-center gap-1 text-caption text-destructive">
              <CircleAlertIcon className="size-4" aria-hidden="true" />
              {t(`substitutionDialog.${errorKey}`)}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t('substitutionDialog.cancel')}
          </Button>
          <Button
            type="button"
            disabled={!canSave}
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
