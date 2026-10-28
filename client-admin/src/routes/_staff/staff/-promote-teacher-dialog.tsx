/**
 * [8.11.8]'s promote-a-member dialog — `POST /teachers` is documented
 * server-side as "promote an existing tenant member to a teacher
 * profile", and this dialog keeps that framing: a member picker over
 * people who are **already members** of the school (minus those who
 * already hold a teacher profile), never a "create a person" form.
 *
 * Error mapping mirrors the server:
 *   - 409 → `employee_id` already exists. It is **globally** unique
 *     (across every tenant), so the copy deliberately doesn't say
 *     "already used in this school".
 *   - 400 → the picked user isn't a member of this tenant (can only
 *     happen via a stale cache; surfaced honestly rather than swallowed).
 *
 * Section assignment lives with the class pages; `POST /teachers` no longer
 * accepts section ids.
 */
import { TeacherDesignation } from '@biddaloy/shared';
import { ApiError } from '@biddaloy/ui/api';
import {
  Button,
  Checkbox,
  HelpHint,
  Combobox,
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
import {
  useAllTeachers,
  useCreateTeacher,
  useDebouncedValue,
  useUser,
  useUsers,
} from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

export interface PromoteTeacherDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Serializes the picked calendar date without a UTC round-trip — same
 * fix `academic-years/-year-form-dialog.tsx`'s `toLocalDateString`
 * documents (`toISOString().slice(0, 10)` rolls the date back a day in
 * any timezone ahead of UTC). */
function toLocalDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function PromoteTeacherDialog({ open, onOpenChange }: PromoteTeacherDialogProps) {
  const { t } = useTranslation('staff');
  const regionConfig = useRegionConfig();
  const createTeacher = useCreateTeacher();

  // The member list is searched on the server as the user types, so any
  // member can be found, not just the first 100. Every teacher is loaded
  // (all pages) so the "already a teacher" exclusion is complete; the server
  // still refuses a duplicate with 409 ALREADY_TEACHER_HERE.
  const [term, setTerm] = React.useState('');
  const search = useDebouncedValue(term.trim(), 300);
  const usersQuery = useUsers({ limit: 100, ...(search ? { search } : {}) });
  const teachersQuery = useAllTeachers({ enabled: open });

  const [userId, setUserId] = React.useState<string | null>(null);
  // Keep the chosen member selectable (and their name shown) when a new
  // search no longer returns them.
  const selectedUser = useUser(userId ?? undefined);
  const [employeeId, setEmployeeId] = React.useState('');
  const [designations, setDesignations] = React.useState<TeacherDesignation[]>([]);
  const [subject, setSubject] = React.useState('');
  const [joiningDate, setJoiningDate] = React.useState<Date | undefined>(undefined);
  const [validationError, setValidationError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setUserId(null);
    setTerm('');
    setEmployeeId('');
    setDesignations([]);
    setSubject('');
    setJoiningDate(undefined);
    setValidationError(null);
    createTeacher.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only on open/close transitions
  }, [open]);

  // Existing members, excluding anyone who already holds a teacher
  // profile — promotion is one-way and one-per-person.
  const existingTeacherUserIds = new Set(
    (teachersQuery.data ?? []).map((teacher) => teacher.user.id),
  );
  // The users query keeps the previous page while a new term loads; only list
  // results once they belong to the typed text.
  const settled = term.trim() === search && !usersQuery.isPlaceholderData;
  const found = settled ? (usersQuery.data?.data ?? []) : [];
  const members =
    userId && selectedUser.data && !found.some((user) => user.id === userId)
      ? [selectedUser.data, ...found]
      : found;
  const memberOptions = members
    .filter((user) => !existingTeacherUserIds.has(user.id))
    .map((user) => ({ value: user.id, label: user.full_name }));

  function toggleDesignation(designation: TeacherDesignation, checked: boolean) {
    setDesignations((current) =>
      checked ? [...current, designation] : current.filter((d) => d !== designation),
    );
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (userId === null) {
      setValidationError(t('teacherForm.errorMemberRequired'));
      return;
    }
    if (employeeId.trim() === '') {
      setValidationError(t('teacherForm.errorEmployeeIdRequired'));
      return;
    }
    setValidationError(null);
    createTeacher.mutate(
      {
        user_id: userId,
        employee_id: employeeId.trim(),
        ...(designations.length > 0 ? { designations } : {}),
        ...(subject.trim() !== '' ? { subject_specialization: subject.trim() } : {}),
        ...(joiningDate !== undefined ? { joining_date: toLocalDateString(joiningDate) } : {}),
      },
      { onSuccess: () => onOpenChange(false) },
    );
  }

  // Three distinct 409s exist server-side — split them by `details.code` so
  // neither an already-promoted member (possible when the picker's
  // 100-teacher page missed them) nor a clash on the kept staff employee ID
  // (the typed one is never written then) is blamed on the typed ID.
  const conflictCode =
    createTeacher.isError &&
    createTeacher.error instanceof ApiError &&
    createTeacher.error.statusCode === 409
      ? (createTeacher.error.details?.code ?? 'EMPLOYEE_ID')
      : null;
  const conflictIsExistingTeacher = conflictCode === 'ALREADY_TEACHER_HERE';
  const conflictIsStaffId = conflictCode === 'STAFF_EMPLOYEE_ID_TAKEN';
  // A 409 with no code is the typed-ID clash; an unknown code gets the generic error.
  const conflict = conflictCode === 'EMPLOYEE_ID';
  const notMember =
    createTeacher.isError &&
    createTeacher.error instanceof ApiError &&
    createTeacher.error.statusCode === 400;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{t('teacherForm.promoteTitle')}</DialogTitle>
            <DialogDescription>{t('teacherForm.promoteDescription')}</DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">{t('teacherForm.memberLabel')}</span>
            <Combobox
              aria-label={t('teacherForm.memberLabel')}
              options={memberOptions}
              value={userId}
              onValueChange={setUserId}
              onQueryChange={setTerm}
              emptyText={t('teacherForm.memberEmpty')}
              announceResults={(count) => t('teacherForm.memberAnnounce', { count })}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-1">
              <label htmlFor="promote-employee-id" className="text-sm font-medium">
                {t('teacherForm.employeeIdLabel')}
              </label>
              <HelpHint helpId="people.staff.field.employeeId" />
            </div>
            <Input
              id="promote-employee-id"
              value={employeeId}
              onChange={(event) => setEmployeeId(event.target.value)}
            />
          </div>

          <fieldset className="flex flex-col gap-1.5">
            {/* The (?) sits outside the legend so it stays out of the group's name. */}
            <legend className="sr-only">{t('teacherForm.designationsLabel')}</legend>
            <div className="flex items-center gap-1 text-sm font-medium">
              <span aria-hidden="true">{t('teacherForm.designationsLabel')}</span>
              <HelpHint helpId="people.staff.field.designations" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              {Object.values(TeacherDesignation).map((designation) => (
                <div key={designation} className="flex items-center gap-2">
                  <Checkbox
                    id={`promote-designation-${designation}`}
                    checked={designations.includes(designation)}
                    onCheckedChange={(checked) => toggleDesignation(designation, checked === true)}
                  />
                  <label htmlFor={`promote-designation-${designation}`} className="text-sm">
                    {t(`teacherForm.designations.${designation}`)}
                  </label>
                </div>
              ))}
            </div>
          </fieldset>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="promote-subject" className="text-sm font-medium">
              {t('teacherForm.subjectLabel')}
            </label>
            <Input
              id="promote-subject"
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
          {createTeacher.isError && (
            <p role="alert" className="text-sm text-destructive">
              {conflictIsExistingTeacher
                ? t('teacherForm.errorAlreadyTeacher')
                : conflictIsStaffId
                  ? t('teacherForm.errorStaffEmployeeIdTaken')
                  : conflict
                    ? t('teacherForm.errorDuplicateEmployeeId')
                    : notMember
                      ? t('teacherForm.errorNotMember')
                      : t('teacherForm.errorMessage')}
            </p>
          )}

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {t('actions.cancel', { ns: 'common' })}
              </Button>
            </DialogClose>
            <Button type="submit" loading={createTeacher.isPending}>
              {createTeacher.isPending ? t('teacherForm.saving') : t('teacherForm.promoteSave')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
