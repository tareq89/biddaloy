/**
 * "Move class" dialog — [8.11.3]. Distinct from `transfer-status-dialog.tsx`
 * (an [8.10.2] feature): that dialog only changes `Student.enrollment_status`
 * (ACTIVE/INACTIVE/TRANSFERRED/GRADUATED); this one moves the student's
 * actual class/section by writing an `Enrollment` row, which is what
 * `EnrollmentService`'s sync-on-ACTIVE side effect uses to update
 * `Student.class_section_id` and reassign the target section's roll
 * number. Two same-named "Transfer" actions on one page doing different
 * things would be confusing, so this one is labelled "Move class"
 * throughout — flagged in the PR description in case a different label
 * is preferred.
 *
 * PATCH vs POST branch: `useCurrentEnrollment` resolves the student's
 * current ACTIVE `Enrollment` row if one exists (every student created
 * after [8.11.3]'s `StudentService.create` dual-write has one from day
 * one); `null` means a legacy student that predates it, so this `POST`s a
 * fresh row instead — same end state either way (the "get-or-create"
 * fallback the issue's scope-expansion section calls for).
 *
 * The class picker is scoped to the current enrollment's own academic
 * year (`EnrollmentService.update` rejects a cross-year class move — an
 * `Enrollment` row's `academic_year_id` isn't patchable, a year change is
 * a promotion, a different feature). A legacy student with no current
 * enrollment has no such year to anchor to, so every class is shown; the
 * server derives the new enrollment's year from whichever class gets
 * picked.
 *
 * Not optimistic — a rolled-back move must never show the student in a
 * class they didn't actually move to (the issue's own acceptance
 * criterion, shared with `transfer-status-dialog.tsx`'s identical
 * reasoning).
 */
import {
  Button,
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
  useCreateEnrollment,
  useCurrentEnrollment,
  useUpdateEnrollment,
} from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { AlertTriangle } from 'lucide-react';
import * as React from 'react';

export interface TransferDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  studentId: string;
  studentName: string;
}

function fieldId(field: string): string {
  return `move-class-${field}`;
}

export function TransferDialog({
  open,
  onOpenChange,
  studentId,
  studentName,
}: TransferDialogProps) {
  const { t } = useTranslation('students');
  const [classId, setClassId] = React.useState('');
  const [sectionId, setSectionId] = React.useState('');

  const currentEnrollmentQuery = useCurrentEnrollment(studentId);
  const currentEnrollment = currentEnrollmentQuery.data;

  const classesQuery = useClasses(
    currentEnrollment ? { academic_year_id: currentEnrollment.academic_year_id } : {},
  );
  const sectionsQuery = useClassSections(classId || undefined);
  const createEnrollment = useCreateEnrollment();
  const updateEnrollment = useUpdateEnrollment(currentEnrollment?.id ?? '');
  const mutation = currentEnrollment ? updateEnrollment : createEnrollment;

  React.useEffect(() => {
    if (open) {
      setClassId(currentEnrollment?.class_id ?? '');
      setSectionId(currentEnrollment?.section_id ?? '');
      createEnrollment.reset();
      updateEnrollment.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only on open/close transitions, once the current enrollment is known
  }, [open, currentEnrollment]);

  const selectedSection = sectionsQuery.data?.find((section) => section.id === sectionId);
  const atCapacity =
    selectedSection != null &&
    selectedSection.capacity != null &&
    selectedSection.enrolled_count >= selectedSection.capacity;

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!classId || !sectionId) return;

    if (currentEnrollment) {
      updateEnrollment.mutate(
        { class_id: classId, section_id: sectionId },
        { onSuccess: () => onOpenChange(false) },
      );
      return;
    }

    const targetClass = classesQuery.data?.data.find((klass) => klass.id === classId);
    if (!targetClass) return;
    createEnrollment.mutate(
      {
        student_id: studentId,
        class_id: classId,
        section_id: sectionId,
        academic_year_id: targetClass.academic_year_id,
      },
      { onSuccess: () => onOpenChange(false) },
    );
  }

  const canSubmit = !!classId && !!sectionId && !currentEnrollmentQuery.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{t('detail.moveClassDialog.title')}</DialogTitle>
            <DialogDescription>
              {t('detail.moveClassDialog.description', { name: studentName })}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4 py-2">
            <div className="flex flex-col gap-1.5">
              <label htmlFor={fieldId('class')} className="text-sm font-medium">
                {t('detail.moveClassDialog.classLabel')}
              </label>
              <Select
                value={classId}
                onValueChange={(value) => {
                  setClassId(value);
                  setSectionId('');
                }}
              >
                <SelectTrigger
                  id={fieldId('class')}
                  aria-label={t('detail.moveClassDialog.classLabel')}
                >
                  <SelectValue placeholder={t('detail.moveClassDialog.classPlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  {classesQuery.data?.data.map((klass) => (
                    <SelectItem key={klass.id} value={klass.id}>
                      {klass.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor={fieldId('section')} className="text-sm font-medium">
                {t('detail.moveClassDialog.sectionLabel')}
              </label>
              <Select value={sectionId} onValueChange={setSectionId} disabled={!classId}>
                <SelectTrigger
                  id={fieldId('section')}
                  aria-label={t('detail.moveClassDialog.sectionLabel')}
                >
                  <SelectValue placeholder={t('detail.moveClassDialog.sectionPlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  {sectionsQuery.data?.map((section) => (
                    <SelectItem key={section.id} value={section.id}>
                      {section.section_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {atCapacity && selectedSection && (
              <div
                role="status"
                className="flex items-start gap-2.5 rounded-md bg-status-due-bg p-3 text-sm text-status-due-fg"
              >
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                <span>
                  {t('detail.moveClassDialog.capacityWarning', {
                    enrolled: selectedSection.enrolled_count,
                    capacity: selectedSection.capacity,
                  })}
                </span>
              </div>
            )}

            {mutation.isError && (
              <p role="alert" className="text-sm text-destructive">
                {t('detail.moveClassDialog.errorMessage')}
              </p>
            )}
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {t('actions.cancel', { ns: 'common' })}
              </Button>
            </DialogClose>
            <Button type="submit" loading={mutation.isPending} disabled={!canSubmit}>
              {mutation.isPending
                ? t('detail.moveClassDialog.moving')
                : t('detail.moveClassDialog.confirm')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
