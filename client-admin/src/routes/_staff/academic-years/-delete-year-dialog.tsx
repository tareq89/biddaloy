import { ConfirmDialog } from '@biddaloy/ui/components';
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

  return (
    <ConfirmDialog
      open={open}
      // A request in flight must not be abandoned by Esc / Cancel / Back.
      onOpenChange={(next) => {
        if (!deleteYear.isPending) onOpenChange(next);
      }}
      title={t('deleteDialog.title')}
      description={
        deleteYear.isError
          ? `${t('deleteDialog.description', { name: academicYearName })} ${t('deleteDialog.errorMessage')}`
          : t('deleteDialog.description', { name: academicYearName })
      }
      confirmLabel={t('deleteDialog.confirm')}
      tone="danger"
      busy={deleteYear.isPending}
      onConfirm={() => deleteYear.mutate(academicYearId, { onSuccess: onDeleted })}
    />
  );
}
