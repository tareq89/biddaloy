import { useDetachClassSubject } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';

import { DangerConfirmDialog } from './-dialog-kit';

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
    <DangerConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('removeSubjectDialog.title')}
      description={t('removeSubjectDialog.description', { name: subjectName })}
      error={detachSubject.isError ? t('removeSubjectDialog.errorMessage') : undefined}
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
