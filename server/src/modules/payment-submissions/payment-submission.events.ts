/** [3.x] Event names for payment submissions (D9 history and in-process bus). */
export const PAYMENT_SUBMISSION_EVENTS = {
  SUBMITTED: 'payment-submission.submitted',
  CONFIRMED: 'payment-submission.confirmed',
  REJECTED: 'payment-submission.rejected',
  DISCARDED: 'payment-submission.discarded',
  WITHDRAWN: 'payment-submission.withdrawn',
  COMPLETED: 'payment-submission.completed',
  FAILED: 'payment-submission.failed',
  EXPIRED: 'payment-submission.expired',
  REVERSED: 'payment-submission.reversed',
} as const;
