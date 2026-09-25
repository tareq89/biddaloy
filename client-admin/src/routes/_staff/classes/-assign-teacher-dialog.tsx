/**
 * [29.0] Shared assign-teacher dialog — one dialog all three wave-3
 * screens (class detail Teachers tab, section detail, teacher detail)
 * build on, so none of them need to touch `hooks/classes.ts` again.
 * Mirrors `-section-form-dialog.tsx`'s self-contained shape (owns its own
 * mutation directly via `useAssignTeacher`).
 *
 * The subject picklist mirrors `-attach-subject-dialog.tsx`'s `Combobox`
 * + `useSubjects` pattern. The teacher picklist has no existing precedent
 * to clone — `-edit-teacher-dialog.tsx` edits an already-known teacher and
 * never picks one — so it reuses the same `Combobox` + list-query shape,
 * backed by `useTeachers` instead of `useSubjects`.
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
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  RadioGroup,
  RadioGroupItem,
} from '@biddaloy/ui/components';
import {
  useAssignTeacher,
  useAssignTeacherAssignment,
  useClasses,
  useClassSections,
  useSubjects,
  useTeachers,
} from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

export interface AssignTeacherDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Omit together with `sectionId` for teacher-centric mode (a class→
   * section picker renders inline instead). */
  classId?: string | undefined;
  sectionId?: string | undefined;
  /** Teacher-centric mode: prefills and hides the teacher picker. */
  teacherId?: string | undefined;
  onAssigned: () => void;
}

type AssignmentMode = 'class-teacher' | 'subject-teacher';

export function AssignTeacherDialog({
  open,
  onOpenChange,
  classId: fixedClassId,
  sectionId: fixedSectionId,
  teacherId: fixedTeacherId,
  onAssigned,
}: AssignTeacherDialogProps) {
  const { t } = useTranslation('classes');
  // Teacher-centric mode has no fixed section to scope `useTeachers`'s
  // caller list by, so it always fetches the reference list — same as the
  // section-scoped mode below, just gated off when the teacher is already
  // known via `fixedTeacherId`.
  const teachersQuery = useTeachers({ limit: 100 });
  const subjectsQuery = useSubjects({ is_active: true, limit: 100 });

  const pickerMode = fixedClassId === undefined || fixedSectionId === undefined;
  const [pickedClassId, setPickedClassId] = React.useState<string | null>(null);
  const [pickedSectionId, setPickedSectionId] = React.useState<string | null>(null);

  const classesQuery = useClasses({}, { enabled: pickerMode });
  const sectionsQuery = useClassSections(pickerMode ? (pickedClassId ?? undefined) : undefined);

  const classId = pickerMode ? pickedClassId : fixedClassId;
  const sectionId = pickerMode ? pickedSectionId : fixedSectionId;

  const boundAssignTeacher = useAssignTeacher(fixedClassId ?? '', fixedSectionId ?? '');
  const unboundAssignTeacher = useAssignTeacherAssignment();

  const [mode, setMode] = React.useState<AssignmentMode>('class-teacher');
  const [teacherId, setTeacherId] = React.useState<string | null>(fixedTeacherId ?? null);
  const [subjectId, setSubjectId] = React.useState<string | null>(null);
  const [validationError, setValidationError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setMode('class-teacher');
    setTeacherId(fixedTeacherId ?? null);
    setSubjectId(null);
    setPickedClassId(null);
    setPickedSectionId(null);
    setValidationError(null);
    boundAssignTeacher.reset();
    unboundAssignTeacher.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only on open/close transitions
  }, [open]);

  const teacherOptions = (teachersQuery.data?.data ?? []).map((teacher) => ({
    value: teacher.id,
    label: `${teacher.user.full_name} (${teacher.employee_id})`,
  }));
  const subjectOptions = (subjectsQuery.data?.data ?? []).map((subject) => ({
    value: subject.id,
    label: `${subject.name_en} (${subject.code})`,
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
    if (mode === 'subject-teacher' && !subjectId) {
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
          ...(mode === 'subject-teacher' && subjectId ? { subject_id: subjectId } : {}),
        },
        { onSuccess: onAssigned },
      );
      return;
    }

    boundAssignTeacher.mutate(
      {
        teacher_id: teacherId,
        ...(mode === 'subject-teacher' && subjectId ? { subject_id: subjectId } : {}),
      },
      { onSuccess: onAssigned },
    );
  }

  const assignTeacher = pickerMode ? unboundAssignTeacher : boundAssignTeacher;
  const conflict =
    assignTeacher.isError &&
    assignTeacher.error instanceof ApiError &&
    assignTeacher.error.statusCode === 409;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{t('assignTeacherForm.title')}</DialogTitle>
            <DialogDescription>{t('assignTeacherForm.description')}</DialogDescription>
          </DialogHeader>

          {pickerMode && (
            <>
              <div className="flex flex-col gap-1.5">
                <span className="text-sm font-medium">{t('assignTeacherForm.classLabel')}</span>
                <Combobox
                  aria-label={t('assignTeacherForm.classLabel')}
                  options={classOptions}
                  value={pickedClassId}
                  onValueChange={(value) => {
                    setPickedClassId(value);
                    setPickedSectionId(null);
                  }}
                  placeholder={t('assignTeacherForm.classPlaceholder')}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <span className="text-sm font-medium">{t('assignTeacherForm.sectionLabel')}</span>
                <Combobox
                  aria-label={t('assignTeacherForm.sectionLabel')}
                  options={sectionOptions}
                  value={pickedSectionId}
                  onValueChange={setPickedSectionId}
                  placeholder={t('assignTeacherForm.sectionPlaceholder')}
                  disabled={!pickedClassId}
                />
              </div>
            </>
          )}

          {fixedTeacherId === undefined && (
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">{t('assignTeacherForm.teacherLabel')}</span>
              <Combobox
                aria-label={t('assignTeacherForm.teacherLabel')}
                options={teacherOptions}
                value={teacherId}
                onValueChange={setTeacherId}
                placeholder={t('assignTeacherForm.teacherPlaceholder')}
              />
            </div>
          )}

          <RadioGroup
            aria-label={t('assignTeacherForm.modeLabel')}
            value={mode}
            onValueChange={(value) => setMode(value as AssignmentMode)}
            className="flex flex-col gap-2"
          >
            <div className="flex items-center gap-2">
              <RadioGroupItem value="class-teacher" id="assign-teacher-mode-class" />
              <label htmlFor="assign-teacher-mode-class" className="text-sm">
                {t('assignTeacherForm.classTeacherOption')}
              </label>
            </div>
            <div className="flex items-center gap-2">
              <RadioGroupItem value="subject-teacher" id="assign-teacher-mode-subject" />
              <label htmlFor="assign-teacher-mode-subject" className="text-sm">
                {t('assignTeacherForm.subjectTeacherOption')}
              </label>
            </div>
          </RadioGroup>

          {mode === 'subject-teacher' && (
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">{t('assignTeacherForm.subjectLabel')}</span>
              <Combobox
                aria-label={t('assignTeacherForm.subjectLabel')}
                options={subjectOptions}
                value={subjectId}
                onValueChange={setSubjectId}
                placeholder={t('assignTeacherForm.subjectPlaceholder')}
              />
            </div>
          )}

          {validationError && (
            <p role="alert" className="text-sm text-destructive">
              {validationError}
            </p>
          )}
          {assignTeacher.isError && (
            <p role="alert" className="text-sm text-destructive">
              {conflict
                ? t('assignTeacherForm.errorDuplicateAssignment')
                : t('assignTeacherForm.errorMessage')}
            </p>
          )}

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {t('actions.cancel', { ns: 'common' })}
              </Button>
            </DialogClose>
            <Button type="submit" loading={assignTeacher.isPending}>
              {assignTeacher.isPending
                ? t('assignTeacherForm.saving')
                : t('assignTeacherForm.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
