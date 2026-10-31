import type { CommunicationLog, ReminderBatchLog } from '@biddaloy/ui/hooks';

/** A log row. The student/guardian views read older endpoints that carry no `trigger` or body. */
export type LogRow = Omit<ReminderBatchLog, 'trigger' | 'message_body'> & {
  trigger: ReminderBatchLog['trigger'] | null;
  message_body: string | null;
};

/** What the older endpoints do not carry; never a Check status (#3343 tracks their filters). */
const SCOPED_DEFAULTS = {
  trigger: null,
  student_id: null,
  guardian_id: null,
  provider: null,
  message_body: null,
  subject: null,
  segments: null,
  batch_id: null,
  is_test: false,
  sent_by_user_id: null,
  sent_by_name: null,
  can_check_status: false,
} satisfies Partial<LogRow>;

export const fromScopedLog = (row: CommunicationLog): LogRow => ({ ...row, ...SCOPED_DEFAULTS });
