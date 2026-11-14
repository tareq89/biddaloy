import { PaymentSubmission } from '../../../modules/payment-submissions/entities/payment-submission.entity';
import { PaymentSubmissionBill } from '../../../modules/payment-submissions/entities/payment-submission-bill.entity';
import { PaymentSubmissionFile } from '../../../modules/payment-submissions/entities/payment-submission-file.entity';
import { PaymentSubmissionEvent } from '../../../modules/payment-submissions/entities/payment-submission-event.entity';
import type { DemoSlice } from '../context';

/**
 * [3.x/#3961] Stub. `owedBy` holds ONE ticket (demo-seed.spec.ts pins `#\d+`): #3973 lands the PROOF
 * rows and deletes it. #3988 then adds the ONLINE rows to this same slice; by then the entities
 * are filled, so nothing is owed any more.
 */
export const slice: DemoSlice = {
  name: 'payment-submissions',
  covers: [PaymentSubmission, PaymentSubmissionBill, PaymentSubmissionFile, PaymentSubmissionEvent],
  owedBy: '#3973',
  run: async () => 0,
};
