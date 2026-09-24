/**
 * [19.8.1] step 7: send every guardian their child's published result by
 * SMS. Disabled entirely while the exam isn't published yet — nothing
 * to send, `ResultSmsService.sendForExam` itself 409s on a non-PUBLISHED
 * exam.
 *
 * `POST /exams/:examId/results/sms` has no dry-run — the recipient count
 * and credit cost shown here are an estimate from the results already on
 * hand (one SMS per published result, at least one guardian each), not a
 * server-confirmed preview.
 * ponytail: no server preview endpoint exists yet for the exact
 * per-guardian count; upgrade this to a real dry-run if the estimate
 * proves confusing in practice.
 */
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@biddaloy/ui/components';
import { useSendResultSms } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';

export interface SendResultSmsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  examId: string;
  examStatus: string;
  resultCount: number;
}

export function SendResultSmsDialog({
  open,
  onOpenChange,
  examId,
  examStatus,
  resultCount,
}: SendResultSmsDialogProps) {
  const { t } = useTranslation('exams');
  const sendSms = useSendResultSms(examId);
  const isPublished = examStatus === 'PUBLISHED';

  function handleOpenChange(next: boolean) {
    if (!next && sendSms.isPending) return;
    if (!next) sendSms.reset();
    onOpenChange(next);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('smsDialog.title')}</DialogTitle>
          <DialogDescription>
            {isPublished
              ? t('smsDialog.description', { count: resultCount })
              : t('smsDialog.disabledUnpublished')}
          </DialogDescription>
        </DialogHeader>

        {isPublished && sendSms.isSuccess && (
          <p className="text-sm text-muted-foreground">
            {t('smsDialog.queued', { count: sendSms.data.queued })}
          </p>
        )}
        {sendSms.isError && (
          <p role="alert" className="text-sm text-destructive">
            {t('smsDialog.errorMessage')}
          </p>
        )}

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              {t('actions.cancel', { ns: 'common' })}
            </Button>
          </DialogClose>
          <Button
            type="button"
            // Once queued, a second click would queue (and bill) every SMS
            // again — closing and reopening the dialog resets this.
            disabled={!isPublished || sendSms.isSuccess}
            loading={sendSms.isPending}
            onClick={() => sendSms.mutate()}
          >
            {t('smsDialog.send')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
