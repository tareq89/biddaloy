import { ApiError } from '@biddaloy/ui/api';
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  NoticeBar,
  Textarea,
  toast,
  HelpHint,
} from '@biddaloy/ui/components';
import { useSendBulkReminder } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { Link } from '@tanstack/react-router';
import * as React from 'react';

import { MAX_BULK_REMINDER_STUDENTS } from '../communications/-shared/reminder-limits';
import { useSmsReadiness } from '../communications/-shared/sms-readiness';

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
  // The server caps one batch (several billed batches with partial failures is worse than a block).
  const over = studentIds.length > MAX_BULK_REMINDER_STUDENTS;
  const limitText = t('sendReminderDialog.limitNotice', {
    count: studentIds.length,
    max: MAX_BULK_REMINDER_STUDENTS,
  });
  const error = sendReminder.error;
  // Only the `@ArrayMaxSize` failure is the cap; a bad id also names `student_ids`.
  const serverSaidTooMany =
    error instanceof ApiError &&
    error.statusCode === 400 &&
    error.messages.some((m) => m.startsWith('student_ids must contain no more than'));
  // [2596] Only a 4xx proves nothing went out. A 5xx or a lost reply may follow a queued batch.
  const errorText = serverSaidTooMany
    ? limitText
    : error instanceof ApiError && error.statusCode < 500
      ? t('sendReminderDialog.errorMessage')
      : t('sendReminderDialog.outcomeUnknown');

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
    if (over) return;
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

  // [78 D37/D38] Warn, never block: guardians on SMS would miss this one.
  const readiness = useSmsReadiness(open);
  const smsNotReady = readiness.data && readiness.data.sms !== 'READY' ? readiness.data.sms : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <div className="flex items-center gap-1">
              <DialogTitle>{t('sendReminderDialog.title')}</DialogTitle>
              <HelpHint helpId="people.students.action.sendReminder" />
            </div>
            <DialogDescription>
              {t('sendReminderDialog.description', { count: studentIds.length })}
            </DialogDescription>
          </DialogHeader>
          {smsNotReady && (
            <div className="mb-2">
              <NoticeBar tone="warning">
                {t(`sendReminderDialog.smsNotReady.${smsNotReady}`)}
              </NoticeBar>
            </div>
          )}
          {over && (
            <p role="status" className="mb-2 text-sm text-destructive">
              {limitText}{' '}
              <Link to="/communications/reminders" className="underline">
                {t('sendReminderDialog.limitLink')}
              </Link>
            </p>
          )}
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
              {errorText}
            </p>
          )}
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {t('actions.cancel', { ns: 'common' })}
              </Button>
            </DialogClose>
            <Button type="submit" disabled={over} loading={sendReminder.isPending}>
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
