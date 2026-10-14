import type { DemoSlice } from '../context';
import { CommunicationLog } from '../../../modules/communications/entities/communication-log.entity';
import { ReminderBatch } from '../../../modules/communications/entities/reminder-batch.entity';
import { SmsCreditBalance } from '../../../modules/communications/credits/entities/sms-credit-balance.entity';
import { SmsCreditLedger } from '../../../modules/communications/credits/entities/sms-credit-ledger.entity';
import { CalendarFeedToken } from '../../../modules/calendar/entities/calendar-feed-token.entity';
import { PrinterProfile } from '../../../modules/print/entities/printer-profile.entity';
import { PrintJob } from '../../../modules/print/entities/print-job.entity';
import { PrintJobItem } from '../../../modules/print/entities/print-job-item.entity';

export const slice: DemoSlice = {
  name: 'comms-print',
  covers: [
    CommunicationLog,
    ReminderBatch,
    SmsCreditBalance,
    SmsCreditLedger,
    CalendarFeedToken,
    PrinterProfile,
    PrintJob,
    PrintJobItem,
  ],
  owedBy: '58.3.06',
  run: async () => {},
};
