import { ApiError } from '@biddaloy/ui/api';
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

  // [68.2.12] A 409 for the current year or a year still in use gets its own
  // plain reason instead of the generic failure line.
  const code = deleteYear.error instanceof ApiError ? deleteYear.error.details?.code : undefined;
  const inUse = code === 'ACADEMIC_YEAR_CURRENT' || code === 'ACADEMIC_YEAR_IN_USE';

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
          ? `${t('deleteDialog.description', { name: academicYearName })} ${inUse ? t('deleteDialog.inUse') : t('deleteDialog.errorMessage')}`
          : t('deleteDialog.description', { name: academicYearName })
      }
      confirmLabel={t('deleteDialog.confirm')}
      tone="danger"
      busy={deleteYear.isPending}
      onConfirm={() => deleteYear.mutate(academicYearId, { onSuccess: onDeleted })}
    />
  );
}
