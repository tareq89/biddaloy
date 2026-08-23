/**
 * [8.11.1]'s own AC: setting a year current has a side effect large
 * enough (it unsets every other year for the tenant —
 * `academic-year.service.ts`'s `setCurrent`) that the confirmation must
 * say so explicitly, not just ask "Are you sure?" — `setCurrentDialog.description`'s
 * wording does exactly that.
 */
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

  function handleConfirm() {
    setCurrent.mutate(academicYearId, { onSuccess: onConfirmed });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('setCurrentDialog.title')}</DialogTitle>
          <DialogDescription>
            {t('setCurrentDialog.description', { name: academicYearName })}
          </DialogDescription>
        </DialogHeader>
        {setCurrent.isError && (
          <p role="alert" className="text-sm text-destructive">
            {t('setCurrentDialog.errorMessage')}
          </p>
        )}
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              {t('actions.cancel', { ns: 'common' })}
            </Button>
          </DialogClose>
          <Button type="button" loading={setCurrent.isPending} onClick={handleConfirm}>
            {setCurrent.isPending
              ? t('setCurrentDialog.confirming')
              : t('setCurrentDialog.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
