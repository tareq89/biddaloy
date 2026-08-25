/**
 * [8.11.8]'s edit-teacher-profile dialog — `PATCH /teachers/{id}`, the
 * same fields the promote dialog captures minus the member picker (a
 * profile is already attached to its person; promotion is not repeated).
 * Kept separate from `-edit-user-dialog.tsx` deliberately: a teacher
 * profile and a user account are different resources.
 *
 * `assigned_section_ids` is not resent here — the server **replaces**
 * the whole set when the key is present, so omitting it entirely is what
 * leaves existing section assignments untouched.
 */
import { TeacherDesignation } from '@biddaloy/shared';
import { ApiError } from '@biddaloy/ui/api';
import {
  Button,
  Checkbox,
  DatePicker,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
} from '@biddaloy/ui/components';
import { useUpdateTeacher, type Teacher } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

export interface EditTeacherDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  teacher: Teacher;
}

function toLocalDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function EditTeacherDialog({ open, onOpenChange, teacher }: EditTeacherDialogProps) {
  const { t } = useTranslation('staff');
  const regionConfig = useRegionConfig();
  const updateTeacher = useUpdateTeacher(teacher.id);

  const [employeeId, setEmployeeId] = React.useState(teacher.employee_id);
  const [designations, setDesignations] = React.useState<TeacherDesignation[]>([
    ...teacher.designations,
  ] as TeacherDesignation[]);
  const [subject, setSubject] = React.useState(teacher.subject_specialization ?? '');
  const [joiningDate, setJoiningDate] = React.useState<Date | undefined>(
    teacher.joining_date !== null ? new Date(teacher.joining_date) : undefined,
  );
  const [validationError, setValidationError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setEmployeeId(teacher.employee_id);
    setDesignations([...teacher.designations] as TeacherDesignation[]);
    setSubject(teacher.subject_specialization ?? '');
    setJoiningDate(teacher.joining_date !== null ? new Date(teacher.joining_date) : undefined);
    setValidationError(null);
    updateTeacher.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only on open/close transitions
  }, [open]);

  function toggleDesignation(designation: TeacherDesignation, checked: boolean) {
    setDesignations((current) =>
      checked ? [...current, designation] : current.filter((d) => d !== designation),
    );
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (employeeId.trim() === '') {
      setValidationError(t('teacherForm.errorEmployeeIdRequired'));
      return;
    }
    setValidationError(null);
    updateTeacher.mutate(
      {
        employee_id: employeeId.trim(),
        designations,
        // Cleared fields send null — omitting them would silently keep
        // the stored value (the server treats null as "clear").
        subject_specialization: subject.trim() !== '' ? subject.trim() : null,
        joining_date: joiningDate !== undefined ? toLocalDateString(joiningDate) : null,
      },
      { onSuccess: () => onOpenChange(false) },
    );
  }

  const conflict =
    updateTeacher.isError &&
    updateTeacher.error instanceof ApiError &&
    updateTeacher.error.statusCode === 409;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{t('teacherForm.editTitle')}</DialogTitle>
            <DialogDescription>{t('teacherForm.editDescription')}</DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="edit-teacher-employee-id" className="text-sm font-medium">
              {t('teacherForm.employeeIdLabel')}
            </label>
            <Input
              id="edit-teacher-employee-id"
              value={employeeId}
              onChange={(event) => setEmployeeId(event.target.value)}
            />
          </div>

          <fieldset className="flex flex-col gap-1.5">
            <legend className="text-sm font-medium">{t('teacherForm.designationsLabel')}</legend>
            <div className="grid grid-cols-2 gap-2">
              {Object.values(TeacherDesignation).map((designation) => (
                <div key={designation} className="flex items-center gap-2">
                  <Checkbox
                    id={`edit-teacher-designation-${designation}`}
                    checked={designations.includes(designation)}
                    onCheckedChange={(checked) => toggleDesignation(designation, checked === true)}
                  />
                  <label htmlFor={`edit-teacher-designation-${designation}`} className="text-sm">
                    {t(`teacherForm.designations.${designation}`)}
                  </label>
                </div>
              ))}
            </div>
          </fieldset>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="edit-teacher-subject" className="text-sm font-medium">
              {t('teacherForm.subjectLabel')}
            </label>
            <Input
              id="edit-teacher-subject"
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">{t('teacherForm.joiningDateLabel')}</span>
            <DatePicker
              aria-label={t('teacherForm.joiningDateLabel')}
              config={regionConfig}
              value={joiningDate}
              onValueChange={setJoiningDate}
            />
          </div>

          {validationError && (
            <p role="alert" className="text-sm text-destructive">
              {validationError}
            </p>
          )}
          {updateTeacher.isError && (
            <p role="alert" className="text-sm text-destructive">
              {conflict ? t('teacherForm.errorDuplicateEmployeeId') : t('teacherForm.errorMessage')}
            </p>
          )}

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {t('actions.cancel', { ns: 'common' })}
              </Button>
            </DialogClose>
            <Button type="submit" loading={updateTeacher.isPending}>
              {updateTeacher.isPending ? t('teacherForm.saving') : t('teacherForm.editSave')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
