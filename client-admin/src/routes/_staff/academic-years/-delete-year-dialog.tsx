import { ApiError } from '@biddaloy/ui/api';
import { ConfirmDialog } from '@biddaloy/ui/components';
import { useDeleteAcademicYear } from '@biddaloy/ui/hooks';
import { useLocale, useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

/** The six counts `ACADEMIC_YEAR_IN_USE` can carry; each non-zero one names a blocker. */
const BLOCKER_KEYS = [
  'classes_count',
  'fee_structures_count',
  'enrollments_count',
  'exams_count',
  'student_fees_count',
  'acr_assessments_count',
] as const;

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
  const { locale } = useLocale();
  const deleteYear = useDeleteAcademicYear();

  React.useEffect(() => {
    if (open) deleteYear.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only on open/close transitions
  }, [open]);

  // [68.2.12] A 409 names which kind of record blocks the delete; anything
  // else keeps the generic failure line.
  function failureReason(): string {
    const error = deleteYear.error;
    if (!(error instanceof ApiError)) return t('deleteDialog.errorMessage');
    if (error.details?.code === 'ACADEMIC_YEAR_CURRENT') return t('deleteDialog.isCurrent');
    if (error.details?.code === 'ACADEMIC_YEAR_IN_USE') {
      const details = error.details;
      const kinds = BLOCKER_KEYS.filter((key) => Number(details[key]) > 0).map((key) =>
        t(`deleteDialog.kinds.${key}`),
      );
      if (kinds.length > 0) {
        const list = new Intl.ListFormat(locale, { type: 'conjunction' }).format(kinds);
        return t('deleteDialog.inUseKinds', { kinds: list });
      }
      return t('deleteDialog.inUseOther');
    }
    return t('deleteDialog.errorMessage');
  }

  return (
    <ConfirmDialog
      open={open}
      // A request in flight must not be abandoned by Esc / Cancel / Back.
      onOpenChange={(next) => {
        if (!deleteYear.isPending) onOpenChange(next);
      }}
      title={t('deleteDialog.title')}
      helpId="academics.academicYears.action.delete"
      description={
        deleteYear.isError
          ? `${t('deleteDialog.description', { name: academicYearName })} ${failureReason()}`
          : t('deleteDialog.description', { name: academicYearName })
      }
      confirmLabel={t('deleteDialog.confirm')}
      tone="danger"
      busy={deleteYear.isPending}
      onConfirm={() => deleteYear.mutate(academicYearId, { onSuccess: onDeleted })}
    />
  );
}
