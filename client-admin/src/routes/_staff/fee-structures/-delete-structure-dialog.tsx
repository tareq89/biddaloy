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
import { ConfirmDialog, toast } from '@biddaloy/ui/components';
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

  // `ConfirmDialog` has no error slot, so a failure closes it and the message shows as a
  // toast. `apiClient` wraps every failed request in `ApiError`, so the status is read off that.
  function handleConfirm() {
    deleteStructure.mutate(feeStructureId, {
      onSuccess: onDeleted,
      onError: (error) => {
        onOpenChange(false);
        toast.error(
          error instanceof ApiError && error.statusCode === 409
            ? t('deleteDialog.conflictMessage')
            : t('deleteDialog.errorMessage'),
        );
      },
    });
  }

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      tone="danger"
      title={t('deleteDialog.title')}
      description={`${t('deleteDialog.description', { name: feeStructureName })} ${t('deleteDialog.sideEffect')}`}
      confirmLabel={t('deleteDialog.confirm')}
      busy={deleteStructure.isPending}
      onConfirm={handleConfirm}
    />
  );
}
