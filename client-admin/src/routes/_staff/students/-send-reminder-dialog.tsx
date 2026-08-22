import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Textarea,
  toast,
} from '@biddaloy/ui/components';
import { useSendBulkReminder } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

export interface SendReminderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  studentIds: readonly string[];
  /** Called once the batch is accepted by the server — the caller (the
   * students list) uses this to clear its own selection, since a sent
   * batch is a completed action, not something still "selected". */
  onSent: () => void;
}

/**
 * A student's guardian, not the student, is who actually receives this —
 * see `SendBulkReminderDto`'s own doc comment on `server/src/modules/
 * communications/dto/reminders.dto.ts`. Not a financial mutation, so
 * unlike `RecordPaymentDialog` ([8.10.5]) this has no "never optimistic"
 * constraint to honour; it's a plain request/response dialog.
 */
export function SendReminderDialog({
  open,
  onOpenChange,
  studentIds,
  onSent,
}: SendReminderDialogProps) {
  const { t } = useTranslation('students');
  const [message, setMessage] = React.useState('');
  const sendReminder = useSendBulkReminder();

  // A closed-then-reopened dialog (a different selection, say) starts
  // from a blank message rather than the previous attempt's text or
  // error — nothing here should look like it belongs to a batch that
  // already went out.
  React.useEffect(() => {
    if (open) {
      setMessage('');
      sendReminder.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only on open/close transitions, not on every sendReminder identity change
  }, [open]);

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    sendReminder.mutate(
      { student_ids: [...studentIds], message_template: message },
      {
        onSuccess: (batch) => {
          onOpenChange(false);
          onSent();
          toast.success(t('sendReminderDialog.successMessage', { count: batch.successful_count }));
        },
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{t('sendReminderDialog.title')}</DialogTitle>
            <DialogDescription>
              {t('sendReminderDialog.description', { count: studentIds.length })}
            </DialogDescription>
          </DialogHeader>
          <Textarea
            aria-label={t('sendReminderDialog.messageLabel')}
            placeholder={t('sendReminderDialog.messagePlaceholder')}
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            required
            rows={4}
          />
          {sendReminder.isError && (
            <p role="alert" className="mt-2 text-sm text-destructive">
              {t('sendReminderDialog.errorMessage')}
            </p>
          )}
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {t('actions.cancel', { ns: 'common' })}
              </Button>
            </DialogClose>
            <Button type="submit" loading={sendReminder.isPending}>
              {sendReminder.isPending
                ? t('sendReminderDialog.sending')
                : t('sendReminderDialog.send')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
