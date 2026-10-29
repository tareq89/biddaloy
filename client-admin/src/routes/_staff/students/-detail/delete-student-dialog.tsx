import { ApiError } from '@biddaloy/ui/api';
import { ConfirmDialog, toast } from '@biddaloy/ui/components';
import { useDeleteStudent } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

export interface DeleteStudentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  studentId: string;
  studentName: string;
  onDeleted: () => void;
}

export function DeleteStudentDialog({
  open,
  onOpenChange,
  studentId,
  studentName,
  onDeleted,
}: DeleteStudentDialogProps) {
  const { t } = useTranslation('students');
  const deleteStudent = useDeleteStudent();

  React.useEffect(() => {
    if (open) deleteStudent.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only on open/close transitions
  }, [open]);

  function handleConfirm() {
    // A failed delete toasts and keeps the dialog open so the user can retry.
    deleteStudent.mutate(studentId, {
      onSuccess: onDeleted,
      onError: (error) => {
        const blocked =
          error instanceof ApiError &&
          error.statusCode === 409 &&
          error.details?.code === 'STUDENT_HAS_OPEN_MONEY';
        toast.error(
          t(blocked ? 'detail.deleteDialog.blockedOpenMoney' : 'detail.deleteDialog.errorMessage'),
        );
      },
    });
  }

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      tone="danger"
      title={t('detail.deleteDialog.title')}
      helpId="people.students.action.delete"
      description={t('detail.deleteDialog.description', { name: studentName })}
      confirmLabel={t('detail.deleteDialog.confirm')}
      busy={deleteStudent.isPending}
      onConfirm={handleConfirm}
    />
  );
}
