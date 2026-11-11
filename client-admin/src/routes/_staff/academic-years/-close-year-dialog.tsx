/**
 * [69.4.04] S2: "Close year". One plain paragraph, then what will no longer change (counts from
 * `GET /academic-years/:id/close-preview`) and what to check first. An open promotion draft
 * blocks the close (D9). Close needs a step-up approval: `useCloseYear` opens the approval modal
 * on `APPROVAL_REQUIRED`.
 */
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  ErrorState,
  NoticeBar,
  Skeleton,
} from '@biddaloy/ui/components';
import { useCloseYear, useYearClosePreview } from '@biddaloy/ui/hooks';
import { useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatCurrency, formatNumber } from '@biddaloy/ui/utils';
import { Link } from '@tanstack/react-router';
import * as React from 'react';

export interface CloseYearDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  academicYearId: string;
  academicYearName: string;
  onClosed: () => void;
}

export function CloseYearDialog({
  open,
  onOpenChange,
  academicYearId,
  academicYearName,
  onClosed,
}: CloseYearDialogProps) {
  const { t } = useTranslation('academicYears');
  const { t: tCommon } = useTranslation('common');
  const regionConfig = useTenantRegionConfig();
  const preview = useYearClosePreview(academicYearId, open);
  const closeYear = useCloseYear();
  const num = (n: number) => formatNumber(n, regionConfig);

  React.useEffect(() => {
    if (open) closeYear.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only when the dialog opens
  }, [open]);

  const data = preview.data;
  const blocked = (data?.blocks.length ?? 0) > 0;
  const freezes = (data?.freezes ?? []).filter((f) => f.count > 0);
  const warnings = (data?.warnings ?? []).filter((w) => w.count > 0);

  return (
    // A request in flight must not be abandoned by Esc / Cancel / outside click.
    <Dialog open={open} onOpenChange={(next) => !closeYear.isPending && onOpenChange(next)}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>{t('closeYear.title', { name: academicYearName })}</DialogTitle>
          <DialogDescription>{t('closeYear.description')}</DialogDescription>
        </DialogHeader>

        {preview.isError ? (
          <ErrorState
            message={t('closeYear.previewError')}
            retryLabel={t('nextYear.retry')}
            onRetry={() => void preview.refetch()}
          />
        ) : preview.isPending ? (
          <div className="flex flex-col gap-2" aria-hidden="true">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-4 w-2/5" />
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {blocked && (
              <NoticeBar
                tone="danger"
                action={
                  <Link to="/promotions" className="font-medium underline underline-offset-2">
                    {t('closeYear.blockedLink')}
                  </Link>
                }
              >
                {t('closeYear.blocked')}
              </NoticeBar>
            )}
            <section aria-labelledby="close-year-freeze" className="flex flex-col gap-1">
              <h3 id="close-year-freeze" className="font-medium">
                {t('closeYear.freezeTitle')}
              </h3>
              {freezes.length === 0 ? (
                <p className="text-text-secondary">{t('closeYear.freezesEmpty')}</p>
              ) : (
                <ul className="list-disc ps-5 text-label tabular-nums">
                  {freezes.map((f) => (
                    <li key={f.table}>
                      {t('closeYear.freezeRow', {
                        label: t(`closeYear.freezes.${f.table}`, { defaultValue: f.table }),
                        count: num(f.count),
                      })}
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-caption text-text-secondary">{t('help.yearClose.payments')}</p>
            </section>
            {warnings.length > 0 && (
              <section aria-labelledby="close-year-warnings" className="flex flex-col gap-1">
                <h3 id="close-year-warnings" className="font-medium">
                  {t('closeYear.warningTitle')}
                </h3>
                <ul className="list-disc ps-5 text-label tabular-nums">
                  {warnings.map((w) => (
                    <li key={w.code}>
                      {t(`closeYear.warnings.${w.code}`, {
                        count: num(w.count),
                        // DUES_OUTSTANDING is whole paisa, every other count is rows.
                        amount: formatCurrency(w.count, regionConfig),
                      })}
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}

        {closeYear.isError && (
          <p role="alert" className="text-label text-destructive">
            {t('closeYear.errorMessage')}
          </p>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={closeYear.isPending}
            onClick={() => onOpenChange(false)}
          >
            {tCommon('actions.cancel')}
          </Button>
          <Button
            type="button"
            loading={closeYear.isPending}
            disabled={!data || blocked || closeYear.isPending}
            onClick={() => closeYear.mutate(academicYearId, { onSuccess: onClosed })}
          >
            {closeYear.isPending ? t('closeYear.closing') : t('closeYear.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
