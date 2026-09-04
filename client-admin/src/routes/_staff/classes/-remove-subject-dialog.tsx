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
import { useDetachClassSubject } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

export interface RemoveSubjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  classId: string;
  academicYearId: string;
  subjectId: string;
  subjectName: string;
  onRemoved: () => void;
}

export function RemoveSubjectDialog({
  open,
  onOpenChange,
  classId,
  academicYearId,
  subjectId,
  subjectName,
  onRemoved,
}: RemoveSubjectDialogProps) {
  const { t } = useTranslation('classes');
  const detachSubject = useDetachClassSubject(classId, academicYearId);

  React.useEffect(() => {
    if (open) detachSubject.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only on open transitions
  }, [open]);

  function handleConfirm() {
    detachSubject.mutate(subjectId, { onSuccess: onRemoved });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('removeSubjectDialog.title')}</DialogTitle>
          <DialogDescription>
            {t('removeSubjectDialog.description', { name: subjectName })}
          </DialogDescription>
        </DialogHeader>
        {detachSubject.isError && (
          <p role="alert" className="text-sm text-destructive">
            {detachSubject.error instanceof Error
              ? detachSubject.error.message
              : t('removeSubjectDialog.errorMessage')}
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
            loading={detachSubject.isPending}
            onClick={handleConfirm}
          >
            {detachSubject.isPending
              ? t('removeSubjectDialog.removing')
              : t('removeSubjectDialog.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
