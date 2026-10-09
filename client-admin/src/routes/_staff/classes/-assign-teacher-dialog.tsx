/**
 * [29.0] Shared assign-teacher dialog — one dialog all three wave-3
 * screens (class detail Teachers tab, section detail, teacher detail)
 * build on, so none of them need to touch `hooks/classes.ts` again.
 * Mirrors `-section-form-dialog.tsx`'s self-contained shape (owns its own
 * mutation directly via `useAssignTeacher`).
 *
 * The subject picklist mirrors `-attach-subject-dialog.tsx`'s `Combobox`
 * pattern, backed by `useAllSubjects` rather than `useSubjects` (see
 * `query-keys.ts`'s `fetchAllPages` — the server caps `limit` at 100, so a
 * single-page fetch silently drops options past that). The teacher
 * picklist has no existing precedent to clone — `-edit-teacher-dialog.tsx`
 * edits an already-known teacher and never picks one — so it reuses the
 * same `Combobox` + all-pages shape, backed by `useAllTeachers`.
 *
 * [#1026 gap fix] `classId`/`sectionId` are now optional. Omitted (the
 * Staff detail tab's teacher-centric mode, no fixed class/section in
 * scope): a `teacherId` prop prefills/hides the teacher picker, an inline
 * class→section `Combobox` picker appears instead (same two-step pattern
 * `teaching-assignments.tsx` uses, Select there vs Combobox here to match
 * this dialog's other pickers), and the unbound
 * `useAssignTeacherAssignment`/`useUnassignTeacherAssignment` hooks are
 * used instead of the bound ones. Provided (g1/g3's existing usage):
 * behavior is unchanged — same bound hooks, same fixed section.
 */
import { ApiError } from '@biddaloy/ui/api';
import {
  Button,
  Combobox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  RadioGroup,
  RadioGroupItem,
} from '@biddaloy/ui/components';
import {
  useAllSubjects,
  useAllTeachers,
  useAssignTeacher,
  useAssignTeacherAssignment,
  useClasses,
  useClassSections,
} from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { TriangleAlertIcon } from 'lucide-react';
import * as React from 'react';

import { ErrorText, Field, useCloseGuard } from './-dialog-kit';

export interface AssignTeacherDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Omit together with `sectionId` for teacher-centric mode (a class→
   * section picker renders inline instead). */
  classId?: string | undefined;
  sectionId?: string | undefined;
  /** Teacher-centric mode: prefills and hides the teacher picker. */
  teacherId?: string | undefined;
  /** [47.4.1] The section's current CLASS_TEACHER (from the Teachers tab's
   * already-loaded `useSectionTeachers`, no refetch). Drives the D3
   * replace warning; only meaningful when `sectionId` is fixed. */
  currentClassTeacher?: { teacherId: string; name: string } | undefined;
  onAssigned: () => void;
}

type TeacherAssignmentType = 'CLASS_TEACHER' | 'ASSISTANT_CLASS_TEACHER' | 'SUBJECT_TEACHER';

const TYPE_ORDER: Record<TeacherAssignmentType, number> = {
  CLASS_TEACHER: 0,
  ASSISTANT_CLASS_TEACHER: 1,
  SUBJECT_TEACHER: 2,
};

/** [47.4.1] Display order for every assignment list: CLASS, ASSISTANT, SUBJECT. */
export function sortByAssignmentType<T extends { assignment_type: TeacherAssignmentType }>(
  rows: readonly T[],
): T[] {
  return [...rows].sort((a, b) => TYPE_ORDER[a.assignment_type] - TYPE_ORDER[b.assignment_type]);
}

export function AssignTeacherDialog({
  open,
  onOpenChange,
  classId: fixedClassId,
  sectionId: fixedSectionId,
  teacherId: fixedTeacherId,
  currentClassTeacher,
  onAssigned,
}: AssignTeacherDialogProps) {
  const { t, i18n } = useTranslation('classes');
  // [pr-fix #1035] `useAllTeachers`/`useAllSubjects` fetch every page, not
  // just the first 100 — the server caps `limit` at 100, so a tenant with
  // more teachers/subjects than that would otherwise have options missing
  // from these pickers. `enabled: fixedTeacherId === undefined` actually
  // gates the teachers fetch off when the teacher is already known — the
  // picker itself is hidden either way (guarded below), this also skips
  // the request.
  const teachersQuery = useAllTeachers({ enabled: fixedTeacherId === undefined });
  const subjectsQuery = useAllSubjects({ is_active: true });

  const pickerMode = fixedClassId === undefined || fixedSectionId === undefined;
  const [pickedClassId, setPickedClassId] = React.useState<string | null>(null);
  const [pickedSectionId, setPickedSectionId] = React.useState<string | null>(null);

  const classesQuery = useClasses({}, { enabled: pickerMode });
  const sectionsQuery = useClassSections(pickerMode ? (pickedClassId ?? undefined) : undefined);

  const classId = pickerMode ? pickedClassId : fixedClassId;
  const sectionId = pickerMode ? pickedSectionId : fixedSectionId;

  const boundAssignTeacher = useAssignTeacher(fixedClassId ?? '', fixedSectionId ?? '');
  const unboundAssignTeacher = useAssignTeacherAssignment();
  const assignTeacher = pickerMode ? unboundAssignTeacher : boundAssignTeacher;

  const [mode, setMode] = React.useState<TeacherAssignmentType>('CLASS_TEACHER');
  const [teacherId, setTeacherId] = React.useState<string | null>(fixedTeacherId ?? null);
  const [subjectId, setSubjectId] = React.useState<string | null>(null);
  const [validationError, setValidationError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setMode('CLASS_TEACHER');
    setTeacherId(fixedTeacherId ?? null);
    setSubjectId(null);
    setPickedClassId(null);
    setPickedSectionId(null);
    setValidationError(null);
    boundAssignTeacher.reset();
    unboundAssignTeacher.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only on open/close transitions
  }, [open]);

  const isDirty =
    mode !== 'CLASS_TEACHER' ||
    teacherId !== (fixedTeacherId ?? null) ||
    subjectId !== null ||
    pickedClassId !== null ||
    pickedSectionId !== null;
  const { requestClose, discardDialog } = useCloseGuard(
    isDirty,
    assignTeacher.isPending,
    onOpenChange,
  );

  const teacherOptions = (teachersQuery.data ?? []).map((teacher) => ({
    value: teacher.id,
    label: `${teacher.user.full_name} (${teacher.employee_id})`,
  }));
  const subjectOptions = (subjectsQuery.data ?? []).map((subject) => ({
    value: subject.id,
    label: `${i18n.language === 'bn' && subject.name_bn ? subject.name_bn : subject.name_en} (${subject.code})`,
  }));
  const classOptions = (classesQuery.data?.data ?? []).map((klass) => ({
    value: klass.id,
    label: klass.name,
  }));
  const sectionOptions = (sectionsQuery.data ?? []).map((section) => ({
    value: section.id,
    label: section.section_name,
  }));

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (assignTeacher.isPending) return;

    if (pickerMode && !classId) {
      setValidationError(t('assignTeacherForm.errorClassRequired'));
      return;
    }
    if (pickerMode && !sectionId) {
      setValidationError(t('assignTeacherForm.errorSectionRequired'));
      return;
    }
    if (!teacherId) {
      setValidationError(t('assignTeacherForm.errorTeacherRequired'));
      return;
    }
    if (mode === 'SUBJECT_TEACHER' && !subjectId) {
      setValidationError(t('assignTeacherForm.errorSubjectRequired'));
      return;
    }
    setValidationError(null);

    if (pickerMode) {
      unboundAssignTeacher.mutate(
        {
          classId: classId!,
          sectionId: sectionId!,
          teacher_id: teacherId,
          assignment_type: mode,
          ...(mode === 'SUBJECT_TEACHER' && subjectId ? { subject_id: subjectId } : {}),
        },
        { onSuccess: onAssigned },
      );
      return;
    }

    boundAssignTeacher.mutate(
      {
        teacher_id: teacherId,
        assignment_type: mode,
        ...(mode === 'SUBJECT_TEACHER' && subjectId ? { subject_id: subjectId } : {}),
      },
      { onSuccess: onAssigned },
    );
  }

  const apiError = assignTeacher.error instanceof ApiError ? assignTeacher.error : null;
  const conflict = assignTeacher.isError && apiError?.statusCode === 409;
  // [47.4.1] Keyed on `details.code`, never the server's English message.
  const homeroomConflict = conflict && apiError?.details?.code === 'TEACHER_ALREADY_HOMEROOM';
  const replaced =
    mode === 'CLASS_TEACHER' && currentClassTeacher && currentClassTeacher.teacherId !== teacherId
      ? currentClassTeacher
      : null;

  return (
    <>
      <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : requestClose())}>
        <DialogContent size="md" onInteractOutside={(e) => e.preventDefault()}>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>{t('assignTeacherForm.title')}</DialogTitle>
              <DialogDescription>{t('assignTeacherForm.description')}</DialogDescription>
            </DialogHeader>

            {pickerMode && (
              <>
                <Field id="assign-teacher-class" label={t('assignTeacherForm.classLabel')} required>
                  <Combobox
                    id="assign-teacher-class"
                    aria-label={t('assignTeacherForm.classLabel')}
                    options={classOptions}
                    value={pickedClassId}
                    onValueChange={(value) => {
                      setPickedClassId(value);
                      setPickedSectionId(null);
                    }}
                    placeholder={t('assignTeacherForm.classPlaceholder')}
                  />
                </Field>
                <Field
                  id="assign-teacher-section"
                  label={t('assignTeacherForm.sectionLabel')}
                  required
                >
                  <Combobox
                    id="assign-teacher-section"
                    aria-label={t('assignTeacherForm.sectionLabel')}
                    options={sectionOptions}
                    value={pickedSectionId}
                    onValueChange={setPickedSectionId}
                    placeholder={t('assignTeacherForm.sectionPlaceholder')}
                    disabled={!pickedClassId}
                  />
                </Field>
              </>
            )}

            {fixedTeacherId === undefined && (
              <Field
                id="assign-teacher-teacher"
                label={t('assignTeacherForm.teacherLabel')}
                required
              >
                <Combobox
                  id="assign-teacher-teacher"
                  aria-label={t('assignTeacherForm.teacherLabel')}
                  options={teacherOptions}
                  value={teacherId}
                  onValueChange={setTeacherId}
                  placeholder={t('assignTeacherForm.teacherPlaceholder')}
                />
              </Field>
            )}

            <fieldset className="flex flex-col gap-1.5">
              <legend className="text-label text-text-primary">
                {t('assignTeacherForm.modeLabel')}
              </legend>
              <RadioGroup
                aria-label={t('assignTeacherForm.modeLabel')}
                value={mode}
                onValueChange={(value) => setMode(value as TeacherAssignmentType)}
                className="flex flex-col gap-1"
              >
                {(
                  [
                    ['CLASS_TEACHER', 'assign-teacher-mode-class'],
                    ['ASSISTANT_CLASS_TEACHER', 'assign-teacher-mode-assistant'],
                    ['SUBJECT_TEACHER', 'assign-teacher-mode-subject'],
                  ] as const
                ).map(([value, id]) => (
                  <div key={value} className="flex min-h-11 items-center gap-3 md:min-h-8">
                    <RadioGroupItem value={value} id={id} />
                    <label htmlFor={id} className="flex-1 cursor-pointer">
                      {t(`assignmentType.${value}`)}
                    </label>
                  </div>
                ))}
              </RadioGroup>
            </fieldset>

            {mode === 'SUBJECT_TEACHER' && (
              <Field
                id="assign-teacher-subject"
                label={t('assignTeacherForm.subjectLabel')}
                required
              >
                <Combobox
                  id="assign-teacher-subject"
                  aria-label={t('assignTeacherForm.subjectLabel')}
                  options={subjectOptions}
                  value={subjectId}
                  onValueChange={setSubjectId}
                  placeholder={t('assignTeacherForm.subjectPlaceholder')}
                />
              </Field>
            )}

            <div aria-live="polite">
              {replaced && (
                <p className="flex items-start gap-2 rounded-md bg-status-due-bg p-3 text-status-due-fg">
                  <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  {t('assignDialog.replaceWarning', { name: replaced.name })}
                </p>
              )}
            </div>

            {validationError && <ErrorText>{validationError}</ErrorText>}
            {assignTeacher.isError && (
              <ErrorText>
                {homeroomConflict
                  ? t('assignTeacherForm.errorAlreadyHomeroom')
                  : conflict
                    ? t('assignTeacherForm.errorDuplicateAssignment')
                    : t('assignTeacherForm.errorMessage')}
              </ErrorText>
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={assignTeacher.isPending}
                onClick={requestClose}
              >
                {t('actions.cancel', { ns: 'common' })}
              </Button>
              <Button type="submit" loading={assignTeacher.isPending}>
                {assignTeacher.isPending
                  ? t('assignTeacherForm.saving')
                  : t('assignTeacherForm.save')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      {discardDialog}
    </>
  );
}
