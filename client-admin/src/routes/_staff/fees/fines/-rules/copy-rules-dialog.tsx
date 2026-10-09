/**
 * [38.4a] "Copy from last year" — cloned from `fees/schedules/-clone-
 * dialog.tsx`'s shape: pick a source year, confirm, `POST /fees/fine-
 * rules/copy` (idempotent — a second run reports everything as skipped).
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@biddaloy/ui/components';
import { useAcademicYears, useCopyFineRules, type CopyFineRulesResult } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

export interface CopyRulesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The year rules are being copied *into* — excluded from the source
   * picker and defaults it to the previous year in the list. */
  toAcademicYearId: string;
  onCopied: () => void;
}

export function CopyRulesDialog({
  open,
  onOpenChange,
  toAcademicYearId,
  onCopied,
}: CopyRulesDialogProps) {
  const { t } = useTranslation('fees');
  const yearsQuery = useAcademicYears();
  const copyRules = useCopyFineRules();

  const otherYears = (yearsQuery.data?.data ?? []).filter((year) => year.id !== toAcademicYearId);
  const [fromAcademicYearId, setFromAcademicYearId] = React.useState('');
  const [result, setResult] = React.useState<CopyFineRulesResult | null>(null);

  React.useEffect(() => {
    if (!open) return;
    copyRules.reset();
    setResult(null);
    // Default to the previous year — the most recently ended year other
    // than the one being copied into.
    setFromAcademicYearId(otherYears[0]?.id ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only on open/close transitions
  }, [open]);

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (fromAcademicYearId === '') return;
    copyRules.mutate(
      { from_academic_year_id: fromAcademicYearId, to_academic_year_id: toAcademicYearId },
      {
        onSuccess: (data) => {
          setResult(data ?? null);
        },
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{t('fines.rules.copyDialog.title')}</DialogTitle>
            <DialogDescription>{t('fines.rules.copyDialog.description')}</DialogDescription>
          </DialogHeader>

          {result ? (
            <p className="text-sm">
              {t('fines.rules.copyDialog.resultMessage', {
                structures: result.structures_created,
                rules: result.rules_created,
                skipped: result.skipped,
              })}
            </p>
          ) : (
            <div className="flex flex-col gap-1.5">
              <label htmlFor="copy-rules-year" className="text-sm font-medium">
                {t('fines.rules.copyDialog.academicYearLabel')}
              </label>
              <Select value={fromAcademicYearId} onValueChange={setFromAcademicYearId}>
                <SelectTrigger id="copy-rules-year">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {otherYears.map((year) => (
                    <SelectItem key={year.id} value={year.id}>
                      {year.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {copyRules.isError && (
            <p role="alert" className="text-sm text-destructive">
              {t('fines.rules.copyDialog.errorMessage')}
            </p>
          )}

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" onClick={() => onCopied()}>
                {result ? t('fines.rules.copyDialog.close') : t('fines.rules.form.cancel')}
              </Button>
            </DialogClose>
            {!result && (
              <Button
                type="submit"
                disabled={fromAcademicYearId === ''}
                loading={copyRules.isPending}
              >
                {copyRules.isPending
                  ? t('fines.rules.copyDialog.copying')
                  : t('fines.rules.copyDialog.confirm')}
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
