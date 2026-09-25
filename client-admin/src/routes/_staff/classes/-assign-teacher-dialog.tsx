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
import { useAssignTeacher, useSubjects, useTeachers } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

export interface AssignTeacherDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  classId: string;
  sectionId: string;
  onAssigned: () => void;
}

type AssignmentMode = 'class-teacher' | 'subject-teacher';

export function AssignTeacherDialog({
  open,
  onOpenChange,
  classId,
  sectionId,
  onAssigned,
}: AssignTeacherDialogProps) {
  const { t } = useTranslation('classes');
  const teachersQuery = useTeachers({ limit: 100 });
  const subjectsQuery = useSubjects({ is_active: true, limit: 100 });
  const assignTeacher = useAssignTeacher(classId, sectionId);

  const [mode, setMode] = React.useState<AssignmentMode>('class-teacher');
  const [teacherId, setTeacherId] = React.useState<string | null>(null);
  const [subjectId, setSubjectId] = React.useState<string | null>(null);
  const [validationError, setValidationError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setMode('class-teacher');
    setTeacherId(null);
    setSubjectId(null);
    setValidationError(null);
    assignTeacher.reset();
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

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    if (!teacherId) {
      setValidationError(t('assignTeacherForm.errorTeacherRequired'));
      return;
    }
    if (mode === 'subject-teacher' && !subjectId) {
      setValidationError(t('assignTeacherForm.errorSubjectRequired'));
      return;
    }
    setValidationError(null);

    assignTeacher.mutate(
      {
        teacher_id: teacherId,
        ...(mode === 'subject-teacher' && subjectId ? { subject_id: subjectId } : {}),
      },
      { onSuccess: onAssigned },
    );
  }

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
