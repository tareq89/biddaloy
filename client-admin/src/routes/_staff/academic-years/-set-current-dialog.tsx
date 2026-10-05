/**
 * [8.11.1]'s own AC: setting a year current has a side effect large
 * enough (it unsets every other year for the tenant —
 * `academic-year.service.ts`'s `setCurrent`) that the confirmation must
 * say so explicitly, not just ask "Are you sure?" — `setCurrentDialog.description`'s
 * wording does exactly that.
 */
import { ConfirmDialog } from '@biddaloy/ui/components';
import { useSetCurrentAcademicYear } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

export interface SetCurrentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  academicYearId: string;
  academicYearName: string;
  onConfirmed: () => void;
}

export function SetCurrentDialog({
  open,
  onOpenChange,
  academicYearId,
  academicYearName,
  onConfirmed,
}: SetCurrentDialogProps) {
  const { t } = useTranslation('academicYears');
  const setCurrent = useSetCurrentAcademicYear();

  React.useEffect(() => {
    if (open) setCurrent.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only on open/close transitions
  }, [open]);

  const description = t('setCurrentDialog.description', { name: academicYearName });

  return (
    <ConfirmDialog
      open={open}
      // A request in flight must not be abandoned by Esc / Cancel / Back.
      onOpenChange={(next) => {
        if (!setCurrent.isPending) onOpenChange(next);
      }}
      tone="default"
      title={t('setCurrentDialog.title')}
      description={
        setCurrent.isError ? `${description} ${t('setCurrentDialog.errorMessage')}` : description
      }
      confirmLabel={t('setCurrentDialog.confirm')}
      busy={setCurrent.isPending}
      onConfirm={() => setCurrent.mutate(academicYearId, { onSuccess: onConfirmed })}
    />
  );
}
