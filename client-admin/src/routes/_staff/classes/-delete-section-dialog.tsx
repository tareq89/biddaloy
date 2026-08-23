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
import { useDeleteSection } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

export interface DeleteSectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  classId: string;
  sectionId: string;
  sectionName: string;
  onDeleted: () => void;
}

export function DeleteSectionDialog({
  open,
  onOpenChange,
  classId,
  sectionId,
  sectionName,
  onDeleted,
}: DeleteSectionDialogProps) {
  const { t } = useTranslation('classes');
  const deleteSection = useDeleteSection(classId);

  React.useEffect(() => {
    if (open) deleteSection.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only on open/close transitions
  }, [open]);

  function handleConfirm() {
    deleteSection.mutate(sectionId, { onSuccess: onDeleted });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('deleteSectionDialog.title')}</DialogTitle>
          <DialogDescription>
            {t('deleteSectionDialog.description', { name: sectionName })}
          </DialogDescription>
        </DialogHeader>
        {deleteSection.isError && (
          // The server's `ConflictException` names the active-student
          // count (`SectionService.remove`) — shown verbatim, same as
          // `-delete-class-dialog.tsx`, rather than a generic failure
          // toast (the issue's own "explanation why" AC).
          <p role="alert" className="text-sm text-destructive">
            {deleteSection.error instanceof Error
              ? deleteSection.error.message
              : t('deleteSectionDialog.errorMessage')}
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
            loading={deleteSection.isPending}
            onClick={handleConfirm}
          >
            {deleteSection.isPending
              ? t('deleteSectionDialog.deleting')
              : t('deleteSectionDialog.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
