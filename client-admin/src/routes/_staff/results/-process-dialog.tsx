/**
 * [19.8.1] step 2: process an exam's results. `ResultsService.process`
 * refuses (409) while any grid is still DRAFT unless `force: true` is
 * sent — and forcing is itself audited server-side (`forced: true` on
 * the same audit record, see `results.service.ts#writeResults`). This
 * dialog lists the outstanding grids and states plainly that "process
 * anyway" is audited, rather than hiding the override behind a silent
 * retry.
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
import { useExamProgress, useProcessResults } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';

export interface ProcessDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  examId: string;
}

export function ProcessDialog({ open, onOpenChange, examId }: ProcessDialogProps) {
  const { t } = useTranslation('exams');
  const progressQuery = useExamProgress(examId);
  const processResults = useProcessResults(examId);

  const outstanding = (progressQuery.data?.outstanding ?? []).filter(
    (row) => row.state === 'DRAFT',
  );

  function handleOpenChange(next: boolean) {
    if (!next && processResults.isPending) return;
    if (!next) processResults.reset();
    onOpenChange(next);
  }

  function process(force: boolean) {
    processResults.mutate(force, { onSuccess: () => onOpenChange(false) });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('processDialog.title')}</DialogTitle>
          <DialogDescription>{t('processDialog.description')}</DialogDescription>
        </DialogHeader>

        {outstanding.length > 0 && (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-muted-foreground">
              {t('processDialog.outstandingCount', { count: outstanding.length })}
            </p>
            <ul className="max-h-40 list-disc overflow-y-auto pl-5 text-sm">
              {outstanding.map((row) => (
                <li key={`${row.section_id}:${row.subject_id}`}>{row.section_name}</li>
              ))}
            </ul>
            <p role="alert" className="text-sm text-destructive">
              {t('processDialog.forceWarning')}
            </p>
          </div>
        )}

        {processResults.isError && (
          <p role="alert" className="text-sm text-destructive">
            {t('processDialog.errorMessage')}
          </p>
        )}

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              {t('actions.cancel', { ns: 'common' })}
            </Button>
          </DialogClose>
          {outstanding.length > 0 ? (
            <Button
              type="button"
              variant="destructive"
              loading={processResults.isPending}
              onClick={() => process(true)}
            >
              {t('processDialog.processAnyway')}
            </Button>
          ) : (
            <Button type="button" loading={processResults.isPending} onClick={() => process(false)}>
              {t('processDialog.confirm')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
