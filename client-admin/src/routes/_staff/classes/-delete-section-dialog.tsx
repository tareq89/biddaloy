import { ApiError } from '@biddaloy/ui/api';
import { ConfirmDialog } from '@biddaloy/ui/components';
import { useDeleteSection } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';

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
  // any other failure each get one translated sentence in place of the prompt.
  const description = !deleteSection.isError
    ? t('deleteSectionDialog.description', { name: sectionName })
    : deleteSection.error instanceof ApiError && deleteSection.error.statusCode === 409
      ? t('deleteSectionDialog.blockedMessage')
      : t('deleteSectionDialog.errorMessage');

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      tone="danger"
      title={t('deleteSectionDialog.title')}
      description={description}
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
