import { describe, expect, it } from 'vitest';

import {
  PaymentGatewayEnvironment,
  PaymentGatewayProvider,
  PaymentProofRejectReason,
  PaymentSubmissionSource,
  PaymentSubmissionStatus,
} from './index';

describe('Epic 3.0 payment submission enums', () => {
  it('pins every value (they are stored and sent over the wire)', () => {
    expect(Object.values(PaymentSubmissionSource)).toEqual(['ONLINE', 'PROOF']);
    expect(Object.values(PaymentSubmissionStatus)).toEqual([
      'PENDING',
      'CONFIRMED',
      'REJECTED',
      'DISCARDED',
      'WITHDRAWN',
      'COMPLETED',
      'FAILED',
      'CANCELLED',
      'EXPIRED',
      'REVERSED',
    ]);
    expect(Object.values(PaymentProofRejectReason)).toEqual([
      'TRXID_NOT_FOUND',
      'AMOUNT_MISMATCH',
      'IMAGE_UNCLEAR',
      'DUPLICATE',
      'OTHER',
    ]);
    expect(Object.values(PaymentGatewayProvider)).toEqual(['BKASH']);
    expect(Object.values(PaymentGatewayEnvironment)).toEqual(['SANDBOX', 'PRODUCTION']);
  });
});
