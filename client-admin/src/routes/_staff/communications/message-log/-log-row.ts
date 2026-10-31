import type { ReminderBatchLog } from '@biddaloy/ui/hooks';

/** A log row. The student/guardian views read older endpoints that carry no `trigger` or `provider`. */
export type LogRow = Omit<ReminderBatchLog, 'trigger'> & {
  trigger: ReminderBatchLog['trigger'] | null;
};
