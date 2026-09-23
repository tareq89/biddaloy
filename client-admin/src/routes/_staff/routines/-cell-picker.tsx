/**
 * [21.8.1] Opened on `Enter`/type-ahead over a grid cell. Subject is a
 * single choice, teachers a multi-choice (D10 — a second teacher is one
 * more checkbox, not a different flow), and recurrence is weekly by
 * default with biweekly/monthly behind one control so the common case
 * (`Enter` → pick subject → pick teacher → save) stays a few keystrokes.
 * A plain filterable checkbox list rather than a new multi-select
 * component — `Combobox` in this package is single-value only, and this
 * school's teacher list is small enough that a scrollable list is the
 * lazy and correct fit (same reasoning `shifts-panel.tsx` gives for its
 * own plain-table-over-DataTable choice).
 */
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
} from '@biddaloy/ui/components';
import { useSubjects, useTeachers, type SlotRecurrenceValue } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

export interface CellPickerValue {
  subjectId: string;
  teacherIds: string[];
  recurrence: SlotRecurrenceValue;
  recurrenceOffset: number;
}

export interface CellPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Existing cell's values when editing, otherwise `undefined` for a
   * fresh empty cell. */
  initialValue?: CellPickerValue | undefined;
  /** [D1 companion] The type-ahead character that opened this picker, if
   * any — pre-filters the subject list to names starting with it. */
  initialFilter?: string | undefined;
  onSave: (value: CellPickerValue) => void;
  saving?: boolean;
}

export function CellPicker({
  open,
  onOpenChange,
  initialValue,
  initialFilter,
  onSave,
  saving = false,
}: CellPickerProps) {
  const { t } = useTranslation('routines');
  const subjectsQuery = useSubjects({});
  const teachersQuery = useTeachers({});

  const [subjectFilter, setSubjectFilter] = React.useState(initialFilter ?? '');
  const [subjectId, setSubjectId] = React.useState(initialValue?.subjectId ?? '');
  const [teacherFilter, setTeacherFilter] = React.useState('');
  const [teacherIds, setTeacherIds] = React.useState<string[]>(initialValue?.teacherIds ?? []);
  const [recurrence, setRecurrence] = React.useState<SlotRecurrenceValue>(
    initialValue?.recurrence ?? 'WEEKLY',
  );
  const [recurrenceOffset, setRecurrenceOffset] = React.useState(
    initialValue?.recurrenceOffset ?? 0,
  );

  React.useEffect(() => {
    if (!open) return;
    setSubjectFilter(initialFilter ?? '');
    setSubjectId(initialValue?.subjectId ?? '');
    setTeacherFilter('');
    setTeacherIds(initialValue?.teacherIds ?? []);
    setRecurrence(initialValue?.recurrence ?? 'WEEKLY');
    setRecurrenceOffset(initialValue?.recurrenceOffset ?? 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reseed only on open, not every keystroke
  }, [open]);

  const subjects = (subjectsQuery.data?.data ?? []).filter((subject) =>
    subject.name_en.toLowerCase().startsWith(subjectFilter.trim().toLowerCase()),
  );
  const teachers = (teachersQuery.data?.data ?? []).filter((teacher) =>
    teacher.user.full_name.toLowerCase().includes(teacherFilter.trim().toLowerCase()),
  );

  function toggleTeacher(teacherId: string) {
    setTeacherIds((current) =>
      current.includes(teacherId)
        ? current.filter((id) => id !== teacherId)
        : [...current, teacherId],
    );
  }

  function handleSave() {
    if (!subjectId || teacherIds.length === 0) return;
    onSave({ subjectId, teacherIds, recurrence, recurrenceOffset });
  }

  const canSave = subjectId !== '' && teacherIds.length > 0;
  const subjectFilterRef = React.useRef<HTMLInputElement>(null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          subjectFilterRef.current?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>{t('cellPicker.title')}</DialogTitle>
          <DialogDescription>{t('cellPicker.description')}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <Label htmlFor="cell-picker-subject-filter">{t('cellPicker.subjectLabel')}</Label>
            <Input
              id="cell-picker-subject-filter"
              ref={subjectFilterRef}
              value={subjectFilter}
              onChange={(event) => setSubjectFilter(event.target.value)}
              placeholder={t('cellPicker.subjectFilterPlaceholder')}
            />
            <ul className="flex max-h-32 flex-col gap-0.5 overflow-y-auto rounded-md border border-border-subtle p-1">
              {subjects.map((subject) => (
                <li key={subject.id}>
                  <button
                    type="button"
                    onClick={() => setSubjectId(subject.id)}
                    aria-pressed={subjectId === subject.id}
                    className={`w-full rounded px-2 py-1 text-left text-sm ${
                      subjectId === subject.id ? 'bg-muted font-medium' : ''
                    }`}
                  >
                    {subject.name_en}
                  </button>
                </li>
              ))}
              {subjects.length === 0 && (
                <li className="px-2 py-1 text-sm text-muted-foreground">
                  {t('cellPicker.noResults')}
                </li>
              )}
            </ul>
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="cell-picker-teacher-filter">{t('cellPicker.teacherLabel')}</Label>
            <Input
              id="cell-picker-teacher-filter"
              value={teacherFilter}
              onChange={(event) => setTeacherFilter(event.target.value)}
              placeholder={t('cellPicker.teacherFilterPlaceholder')}
            />
            <ul className="flex max-h-32 flex-col gap-0.5 overflow-y-auto rounded-md border border-border-subtle p-1">
              {teachers.map((teacher) => (
                <li key={teacher.id} className="flex items-center gap-2 px-2 py-1">
                  <Checkbox
                    id={`cell-picker-teacher-${teacher.id}`}
                    checked={teacherIds.includes(teacher.id)}
                    onCheckedChange={() => toggleTeacher(teacher.id)}
                  />
                  <Label htmlFor={`cell-picker-teacher-${teacher.id}`} className="text-sm">
                    {teacher.user.full_name}
                  </Label>
                </li>
              ))}
              {teachers.length === 0 && (
                <li className="px-2 py-1 text-sm text-muted-foreground">
                  {t('cellPicker.noResults')}
                </li>
              )}
            </ul>
          </div>

          <fieldset className="flex flex-col gap-1">
            <legend className="text-sm font-medium">{t('cellPicker.recurrenceLabel')}</legend>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="cell-picker-recurrence"
                checked={recurrence === 'WEEKLY'}
                onChange={() => setRecurrence('WEEKLY')}
              />
              {t('cellPicker.recurrenceWeekly')}
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="cell-picker-recurrence"
                checked={recurrence === 'BIWEEKLY'}
                onChange={() => setRecurrence('BIWEEKLY')}
              />
              {t('cellPicker.recurrenceBiweekly')}
              {recurrence === 'BIWEEKLY' && (
                <select
                  aria-label={t('cellPicker.recurrenceOffsetLabel')}
                  className="h-7 rounded-md border border-input bg-card px-1.5 text-sm"
                  value={recurrenceOffset}
                  onChange={(event) => setRecurrenceOffset(Number(event.target.value))}
                >
                  <option value={0}>{t('cellPicker.recurrenceWeekA')}</option>
                  <option value={1}>{t('cellPicker.recurrenceWeekB')}</option>
                </select>
              )}
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="cell-picker-recurrence"
                checked={recurrence === 'MONTHLY'}
                onChange={() => setRecurrence('MONTHLY')}
              />
              {t('cellPicker.recurrenceMonthly')}
              {recurrence === 'MONTHLY' && (
                <select
                  aria-label={t('cellPicker.recurrenceOffsetLabel')}
                  className="h-7 rounded-md border border-input bg-card px-1.5 text-sm"
                  value={recurrenceOffset}
                  onChange={(event) => setRecurrenceOffset(Number(event.target.value))}
                >
                  {[0, 1, 2, 3].map((occurrence) => (
                    <option key={occurrence} value={occurrence}>
                      {t('cellPicker.recurrenceOccurrence', { n: occurrence + 1 })}
                    </option>
                  ))}
                </select>
              )}
            </label>
          </fieldset>
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            {t('cellPicker.cancel')}
          </Button>
          <Button type="button" disabled={!canSave} loading={saving} onClick={handleSave}>
            {t('cellPicker.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
