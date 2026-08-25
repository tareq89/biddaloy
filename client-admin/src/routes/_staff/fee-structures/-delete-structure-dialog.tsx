/**
 * [8.11.5]'s delete-confirmation dialog.
 *
 * The copy names the *real* side effect, which is narrower than it might
 * look: `FeeStructureService.remove` soft-deletes only the structure
 * itself. Fees already generated from it — paid or not — are left exactly
 * as they are. What actually changes is that future fee generation stops
 * matching this structure.
 *
 * If any payment has already been allocated against a fee generated from
 * the structure, the server refuses with 409 and the dialog explains that
 * instead of the generic failure message.
 */
import { ApiError } from '@biddaloy/ui/api';
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
import { useDeleteFeeStructure } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

export interface DeleteStructureDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  feeStructureId: string;
  feeStructureName: string;
  onDeleted: () => void;
}

export function DeleteStructureDialog({
  open,
  onOpenChange,
  feeStructureId,
  feeStructureName,
  onDeleted,
}: DeleteStructureDialogProps) {
  const { t } = useTranslation('feeStructures');
  const deleteStructure = useDeleteFeeStructure();

  React.useEffect(() => {
    if (open) deleteStructure.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only on open/close transitions
  }, [open]);

  function handleConfirm() {
    deleteStructure.mutate(feeStructureId, { onSuccess: onDeleted });
  }

  // `apiClient`'s response interceptor wraps every failed request in
  // `ApiError` before it reaches the mutation's error state, so the status
  // is read off that rather than off a raw `AxiosError`.
  const isConflict =
    deleteStructure.error instanceof ApiError && deleteStructure.error.statusCode === 409;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('deleteDialog.title')}</DialogTitle>
          <DialogDescription>
            {t('deleteDialog.description', { name: feeStructureName })}
          </DialogDescription>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">{t('deleteDialog.sideEffect')}</p>
        {deleteStructure.isError && (
          <p role="alert" className="text-sm text-destructive">
            {isConflict ? t('deleteDialog.conflictMessage') : t('deleteDialog.errorMessage')}
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
            loading={deleteStructure.isPending}
            onClick={handleConfirm}
          >
            {deleteStructure.isPending ? t('deleteDialog.deleting') : t('deleteDialog.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
