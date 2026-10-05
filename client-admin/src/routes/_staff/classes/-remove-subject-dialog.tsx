import { ConfirmDialog } from '@biddaloy/ui/components';
import { useDetachClassSubject } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';

export interface RemoveSubjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  classId: string;
  academicYearId: string;
  subjectId: string;
  subjectName: string;
  onRemoved: () => void;
}

/** Callers mount this only while open, so mutation state is fresh each time. */
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

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      tone="danger"
      title={t('removeSubjectDialog.title')}
      description={
        detachSubject.isError
          ? t('removeSubjectDialog.errorMessage')
          : t('removeSubjectDialog.description', { name: subjectName })
      }
      confirmLabel={
        detachSubject.isPending
          ? t('removeSubjectDialog.removing')
          : t('removeSubjectDialog.confirm')
      }
      busy={detachSubject.isPending}
      onConfirm={() => detachSubject.mutate(subjectId, { onSuccess: onRemoved })}
    />
  );
}
