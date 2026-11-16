/**
 * [71.4.08] Upload a list of lottery numbers made outside the app: check the file, read the row
 * errors (they name the row and the problem, never the cell value, Rule 23), then save.
 */
import { ApiError } from '@biddaloy/ui/api';
import { Button, Dialog, DialogContent, DialogHeader, DialogTitle } from '@biddaloy/ui/components';
import {
  useCommitLotteryImport,
  useValidateLotteryImport,
  type LotteryImportValidation,
} from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatNumber } from '@biddaloy/ui/utils';
import * as React from 'react';

const KNOWN = [
  'UNKNOWN_APPLICANT',
  'DUPLICATE_APPLICANT',
  'INVALID_RANK',
  'DUPLICATE_RANK',
  'MISSING_APPLICANTS',
];

export function LotteryImportDialog({
  stageId,
  open,
  onOpenChange,
}: {
  stageId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation('admission-stages');
  const region = useRegionConfig();
  const validate = useValidateLotteryImport(stageId);
  const commit = useCommitLotteryImport(stageId);
  const [file, setFile] = React.useState<File | null>(null);
  const [result, setResult] = React.useState<LotteryImportValidation | null>(null);
  const [error, setError] = React.useState<'file' | 'save' | 'expired' | null>(null);
  const errors = result?.errors.filter((e) => e.severity === 'error') ?? [];
  const busy = validate.isPending || commit.isPending;

  async function check() {
    if (!file) return;
    setError(null);
    setResult(null);
    try {
      setResult(await validate.mutateAsync(file));
    } catch {
      setError('file');
    }
  }
  async function save() {
    if (!result?.staging_id) return;
    setError(null);
    try {
      await commit.mutateAsync({ staging_id: result.staging_id });
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof ApiError && e.statusCode === 404 ? 'expired' : 'save');
      setResult(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (busy ? undefined : onOpenChange(o))}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{t('lotteryImport.title')}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <p className="text-sm">{t('lotteryImport.explain')}</p>
          <input
            type="file"
            accept=".xlsx"
            aria-label={t('lotteryImport.file')}
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setResult(null);
              setError(null);
            }}
          />
          <div className="flex gap-2">
            <Button variant="outline" disabled={!file || busy} onClick={() => void check()}>
              {validate.isPending ? t('lotteryImport.checking') : t('lotteryImport.check')}
            </Button>
            <Button
              disabled={!result?.staging_id || errors.length > 0 || busy}
              onClick={() => void save()}
            >
              {commit.isPending ? t('lotteryImport.saving') : t('lotteryImport.save')}
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => onOpenChange(false)}>
              {t('lotteryImport.cancel')}
            </Button>
          </div>
          {error ? (
            <p role="alert">
              {error === 'file'
                ? t('lotteryImport.fileError')
                : error === 'expired'
                  ? t('lotteryImport.expired')
                  : t('lotteryImport.saveError')}
            </p>
          ) : null}
          {result ? (
            <div className="flex flex-col gap-2">
              <p role="status">
                {t('lotteryImport.rows', { count: formatNumber(result.rows, region) })}{' '}
                {result.staging_id && errors.length === 0 ? t('lotteryImport.ok') : null}
              </p>
              {errors.length > 0 ? (
                <section aria-label={t('lotteryImport.errorsTitle')}>
                  <h3 className="font-medium">{t('lotteryImport.errorsTitle')}</h3>
                  <ul className="max-h-64 divide-y overflow-auto rounded-md border">
                    {errors.map((e, i) => (
                      <li key={i} className="px-2 py-1 text-sm">
                        <span className="font-medium">
                          {e.row > 0
                            ? t('lotteryImport.row', { row: formatNumber(e.row, region) })
                            : t('lotteryImport.wholeFile')}
                        </span>
                        {': '}
                        {t(
                          `lotteryImport.codes.${e.code && KNOWN.includes(e.code) ? e.code : 'other'}`,
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
