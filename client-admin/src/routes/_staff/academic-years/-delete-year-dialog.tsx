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
import { useDeleteAcademicYear } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

export interface DeleteYearDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  academicYearId: string;
  academicYearName: string;
  onDeleted: () => void;
}

export function DeleteYearDialog({
  open,
  onOpenChange,
  academicYearId,
  academicYearName,
  onDeleted,
}: DeleteYearDialogProps) {
  const { t } = useTranslation('academicYears');
  const deleteYear = useDeleteAcademicYear();

  React.useEffect(() => {
    if (open) deleteYear.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only on open/close transitions
  }, [open]);

  function handleConfirm() {
    deleteYear.mutate(academicYearId, { onSuccess: onDeleted });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('deleteDialog.title')}</DialogTitle>
          <DialogDescription>
            {t('deleteDialog.description', { name: academicYearName })}
          </DialogDescription>
        </DialogHeader>
        {deleteYear.isError && (
          <p role="alert" className="text-sm text-destructive">
            {t('deleteDialog.errorMessage')}
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
            loading={deleteYear.isPending}
            onClick={handleConfirm}
          >
            {deleteYear.isPending ? t('deleteDialog.deleting') : t('deleteDialog.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
