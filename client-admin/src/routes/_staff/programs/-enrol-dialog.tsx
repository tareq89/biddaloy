/**
 * Enrol students into a program — [34.4.1], D16. Class → section selects
 * reuse `useClasses`/`useClassSections`, the same hooks
 * `students/index.tsx`'s filter bar already uses. A student multi-select
 * (checkbox list, "select all") over `useStudents({ class_id, section_id })`
 * — no `MultiSelect` primitive exists in the design system yet, and a
 * checkbox list is the same control `-band-editor.tsx`'s `is_fail` column
 * already uses, so nothing new was added for this.
 *
 * When opened from the list page with no `programId` (D10 palette entry,
 * `?enrol=1` with no program in context), a Program select is shown first;
 * the Students-tab toolbar always passes a real `programId` and never sees
 * it.
 */
import {
  Button,
  Checkbox,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@biddaloy/ui/components';
import {
  useClasses,
  useClassSections,
  useEnrolStudents,
  usePrograms,
  useStudents,
} from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

export interface EnrolDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  programId: string;
  studentIdPrefill?: string | undefined;
  onEnrolled: () => void;
}

export function EnrolDialog({
  open,
  onOpenChange,
  programId,
  studentIdPrefill,
  onEnrolled,
}: EnrolDialogProps) {
  const { t } = useTranslation('programs');
  const { t: tCommon } = useTranslation('common');

  const [selectedProgramId, setSelectedProgramId] = React.useState(programId);
  const [classId, setClassId] = React.useState('');
  const [sectionId, setSectionId] = React.useState('');
  const [studentIds, setStudentIds] = React.useState<Set<string>>(
    new Set(studentIdPrefill ? [studentIdPrefill] : []),
  );
  const [startedOn, setStartedOn] = React.useState(() => new Date().toISOString().slice(0, 10));
  const [resultMessage, setResultMessage] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setSelectedProgramId(programId);
    setClassId('');
    setSectionId('');
    setStudentIds(new Set(studentIdPrefill ? [studentIdPrefill] : []));
    setStartedOn(new Date().toISOString().slice(0, 10));
    setResultMessage(null);
  }, [open, programId, studentIdPrefill]);

  const programsQuery = usePrograms();
  const classesQuery = useClasses();
  const sectionsQuery = useClassSections(classId || undefined);
  const studentsQuery = useStudents(
    {
      ...(classId ? { class_id: classId } : {}),
      ...(sectionId ? { section_id: sectionId } : {}),
      limit: 200,
    },
    { enabled: Boolean(classId) },
  );
  const enrolStudents = useEnrolStudents(selectedProgramId);

  function toggleStudent(id: string) {
    setStudentIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll(ids: string[]) {
    setStudentIds((prev) => (prev.size === ids.length ? new Set() : new Set(ids)));
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedProgramId || studentIds.size === 0) return;
    enrolStudents.mutate(
      { student_ids: Array.from(studentIds), started_on: startedOn },
      {
        onSuccess: (result) => {
          if (result.skipped > 0) {
            setResultMessage(t('dialogs.enrol.skipped', { count: result.skipped }));
          } else {
            onEnrolled();
          }
        },
      },
    );
  }

  const students = studentsQuery.data?.data ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{t('dialogs.enrol.title')}</DialogTitle>
            <DialogDescription>{t('dialogs.enrol.title')}</DialogDescription>
          </DialogHeader>

          {!programId && (
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">{t('list.title')}</span>
              <Select value={selectedProgramId} onValueChange={setSelectedProgramId}>
                <SelectTrigger aria-label={t('list.title')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(programsQuery.data ?? []).map((program) => (
                    <SelectItem key={program.id} value={program.id}>
                      {program.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">{t('dialogs.enrol.class')}</span>
            <Select
              value={classId}
              onValueChange={(value) => {
                setClassId(value);
                setSectionId('');
              }}
            >
              <SelectTrigger aria-label={t('dialogs.enrol.class')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(classesQuery.data?.data ?? []).map((klass) => (
                  <SelectItem key={klass.id} value={klass.id}>
                    {klass.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">{t('dialogs.enrol.section')}</span>
            <Select value={sectionId} onValueChange={setSectionId}>
              <SelectTrigger aria-label={t('dialogs.enrol.section')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(sectionsQuery.data ?? []).map((section) => (
                  <SelectItem key={section.id} value={section.id}>
                    {section.section_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">{t('dialogs.enrol.students')}</span>
              {students.length > 0 && (
                <button
                  type="button"
                  className="text-sm text-primary underline"
                  onClick={() => toggleSelectAll(students.map((s) => s.id))}
                >
                  {tCommon('table.selectAllOnPage')}
                </button>
              )}
            </div>
            <ul className="flex max-h-48 flex-col gap-1 overflow-auto">
              {students.map((student) => (
                <li key={student.id}>
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={studentIds.has(student.id)}
                      onCheckedChange={() => toggleStudent(student.id)}
                    />
                    {student.full_name}
                  </label>
                </li>
              ))}
            </ul>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="enrol-started-on" className="text-sm font-medium">
              {t('dialogs.enrol.startedOn')}
            </label>
            <input
              id="enrol-started-on"
              type="date"
              value={startedOn}
              onChange={(e) => setStartedOn(e.target.value)}
              className="h-9 rounded-md border border-border bg-card px-3 text-sm"
            />
          </div>

          {resultMessage && <p className="text-sm text-muted-foreground">{resultMessage}</p>}
          {enrolStudents.isError && (
            <p role="alert" className="text-sm text-destructive">
              {t('dialogs.enrol.errorMessage')}
            </p>
          )}

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {tCommon('actions.cancel')}
              </Button>
            </DialogClose>
            <Button type="submit" loading={enrolStudents.isPending}>
              {t('students.enrol')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
