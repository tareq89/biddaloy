/**
 * [8.11.1]'s own AC: setting a year current has a side effect large
 * enough (it unsets every other year for the tenant —
 * `academic-year.service.ts`'s `setCurrent`) that the confirmation must
 * say so explicitly, not just ask "Are you sure?" — `setCurrentDialog.description`'s
 * wording does exactly that.
 *
 * [69.4.04] S3: also shows what the year has today (`GET /academic-years/:id/readiness`) and warns,
 * never blocks (D3), when no teacher is assigned to a class in it. `ConfirmDialog` takes only a
 * text description, so this is a `Dialog` with the same shape: Cancel left, primary right.
 */
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  NoticeBar,
} from '@biddaloy/ui/components';
import { useSetCurrentAcademicYear, useYearReadiness } from '@biddaloy/ui/hooks';
import { useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatNumber } from '@biddaloy/ui/utils';
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
  const { t: tCommon } = useTranslation('common');
  const regionConfig = useTenantRegionConfig();
  const setCurrent = useSetCurrentAcademicYear();
  const readiness = useYearReadiness(academicYearId, open);

  React.useEffect(() => {
    if (open) setCurrent.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only on open/close transitions
  }, [open]);

  const num = (n: number) => formatNumber(n, regionConfig);
  const data = readiness.data;

  return (
    // A request in flight must not be abandoned by Esc / Cancel / Back.
    <Dialog open={open} onOpenChange={(next) => !setCurrent.isPending && onOpenChange(next)}>
      {/* Same alertdialog behaviour the plain ConfirmDialog had: a click outside never confirms. */}
      <DialogContent
        size="sm"
        role="alertdialog"
        showCloseButton={false}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{t('setCurrentDialog.title')}</DialogTitle>
          <DialogDescription>
            {t('setCurrentDialog.description', { name: academicYearName })}
          </DialogDescription>
        </DialogHeader>

        {data && (
          <p className="text-label text-text-secondary tabular-nums">
            {t('readiness.summary', {
              classes: num(data.classes),
              teachers: num(data.teacher_assignments),
              runs: num(data.committed_promotion_runs),
            })}
          </p>
        )}
        {data && data.teacher_assignments === 0 && (
          <NoticeBar tone="warning">{t('readiness.noTeachers')}</NoticeBar>
        )}
        {setCurrent.isError && (
          <p role="alert" className="text-label text-destructive">
            {t('setCurrentDialog.errorMessage')}
          </p>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={setCurrent.isPending}
            onClick={() => onOpenChange(false)}
          >
            {tCommon('actions.cancel')}
          </Button>
          <Button
            type="button"
            loading={setCurrent.isPending}
            onClick={() => setCurrent.mutate(academicYearId, { onSuccess: onConfirmed })}
          >
            {t('setCurrentDialog.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
