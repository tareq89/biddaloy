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
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatNumber } from '@biddaloy/ui/utils';
import { CircleAlertIcon, TriangleAlertIcon } from 'lucide-react';

export interface ProcessDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  examId: string;
}

export function ProcessDialog({ open, onOpenChange, examId }: ProcessDialogProps) {
  const { t, i18n } = useTranslation('exams');
  const { t: tg } = useTranslation('grading');
  const config = useRegionConfig();
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
      <DialogContent size="md" closeLabel={t('actions.close', { ns: 'common' })}>
        <DialogHeader>
          <DialogTitle>{t('processDialog.title')}</DialogTitle>
          <DialogDescription>{t('processDialog.description')}</DialogDescription>
        </DialogHeader>

        {outstanding.length > 0 && (
          <div className="flex flex-col gap-2">
            <p className="text-text-secondary">
              {tg('resultsPage.outstandingCount', { n: formatNumber(outstanding.length, config) })}
            </p>
            <ul className="max-h-40 divide-y divide-border-subtle overflow-y-auto rounded-md border border-border-subtle">
              {outstanding.map((row) => {
                const subject =
                  i18n.language === 'bn'
                    ? (row.subject_name_bn ?? row.subject_name)
                    : row.subject_name;
                return (
                  <li key={`${row.section_id}:${row.subject_id}`} className="px-3 py-2">
                    {tg('marksEntry.sectionValue', { name: row.section_name })}
                    {subject ? ` · ${subject}` : ''}
                  </li>
                );
              })}
            </ul>
            <p
              role="alert"
              className="flex gap-2 rounded-md bg-status-due-bg p-3 text-status-due-fg"
            >
              <TriangleAlertIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              {t('processDialog.forceWarning')}
            </p>
          </div>
        )}

        {processResults.isError && (
          <p role="alert" className="flex items-center gap-1 text-caption text-destructive">
            <CircleAlertIcon aria-hidden="true" className="size-3.5" />
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
