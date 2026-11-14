import { PaymentSubmission } from '../../../modules/payment-submissions/entities/payment-submission.entity';
import { PaymentSubmissionBill } from '../../../modules/payment-submissions/entities/payment-submission-bill.entity';
import { PaymentSubmissionFile } from '../../../modules/payment-submissions/entities/payment-submission-file.entity';
import { PaymentSubmissionEvent } from '../../../modules/payment-submissions/entities/payment-submission-event.entity';
import type { DemoSlice } from '../context';

/** [3.x/#3961] Stub: rows land in #3973 (PROOF) and #3988 (ONLINE); that ticket deletes `owedBy`. */
export const slice: DemoSlice = {
  name: 'payment-submissions',
  covers: [PaymentSubmission, PaymentSubmissionBill, PaymentSubmissionFile, PaymentSubmissionEvent],
  owedBy: '#3973',
  run: async () => 0,
};
