import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@biddaloy/ui/components';
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
    deleteStudent.mutate(studentId, { onSuccess: onDeleted });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('detail.deleteDialog.title')}</DialogTitle>
          <DialogDescription>
            {t('detail.deleteDialog.description', { name: studentName })}
          </DialogDescription>
        </DialogHeader>
        {deleteStudent.isError && (
          <p role="alert" className="text-sm text-destructive">
            {t('detail.deleteDialog.errorMessage')}
          </p>
        )}
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              {t('actions.cancel', { ns: 'common' })}
            </Button>
          </DialogClose>
          <Button
            type="button"
            variant="destructive"
            loading={deleteStudent.isPending}
            onClick={handleConfirm}
          >
            {deleteStudent.isPending
              ? t('detail.deleteDialog.deleting')
              : t('detail.deleteDialog.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
