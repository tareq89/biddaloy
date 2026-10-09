import { ApiError } from '@biddaloy/ui/api';
import { useDeleteSection } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';

import { DangerConfirmDialog } from './-dialog-kit';

export interface DeleteSectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  classId: string;
  sectionId: string;
  sectionName: string;
  onDeleted: () => void;
}

/** Callers mount this only while open, so mutation state is fresh each time. */
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

  // The server sentence is English and carries ids — never shown; a 409 and
  // any other failure each get one translated sentence beside the prompt.
  const error = !deleteSection.isError
    ? undefined
    : deleteSection.error instanceof ApiError && deleteSection.error.statusCode === 409
      ? t('deleteSectionDialog.blockedMessage')
      : t('deleteSectionDialog.errorMessage');

  return (
    <DangerConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('deleteSectionDialog.title')}
      description={t('deleteSectionDialog.description', { name: sectionName })}
      error={error}
      confirmLabel={
        deleteSection.isPending
          ? t('deleteSectionDialog.deleting')
          : t('deleteSectionDialog.confirm')
      }
      busy={deleteSection.isPending}
      onConfirm={() => deleteSection.mutate(sectionId, { onSuccess: onDeleted })}
    />
  );
}
