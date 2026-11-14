import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  PAYMENT_SUBMISSION_EVENTS,
  paymentSubmissionEvents,
} from '../payment-submissions/payment-submission.events';
import { PaymentSubmissionNotificationsListener } from './payment-submission-notifications.listener';

const event = { tenantId: 't1', submissionId: 's1', actorUserId: 'staff-1' };

function build(row: Record<string, unknown> | undefined, locale = 'en-US') {
  const query = vi.fn().mockResolvedValue(row ? [row] : []);
  const sendToUser = vi.fn().mockResolvedValue({ accepted: 1, transient: 0, pruned: 0 });
  const listener = new PaymentSubmissionNotificationsListener(
    { query } as never,
    { sendToUser } as never,
    { getResolvedSettings: vi.fn().mockResolvedValue({ region: { locale } }) } as never,
  );
  return { listener, query, sendToUser };
}

describe('PaymentSubmissionNotificationsListener', () => {
  beforeEach(() => paymentSubmissionEvents.removeAllListeners());

  it.each(['SUBMITTED', 'CONFIRMED', 'REJECTED', 'DISCARDED'] as const)(
    '%s sends exactly one push, to the submitting guardian only',
    async (kind) => {
      const { listener, sendToUser } = build({
        submitted_by_user_id: 'guardian-1',
        source: 'PROOF',
        reject_reason: null,
      });
      await listener.handle(kind, event);
      expect(sendToUser).toHaveBeenCalledTimes(1);
      // Recipient is the submitter, never the staff actor.
      expect(sendToUser.mock.calls[0].slice(0, 2)).toEqual(['guardian-1', 't1']);
    },
  );

  it('reject push carries the reason label, not a free-text note', async () => {
    const { listener, sendToUser } = build({
      submitted_by_user_id: 'g1',
      source: 'PROOF',
      reject_reason: 'AMOUNT_MISMATCH',
    });
    await listener.handle('REJECTED', event);
    expect(sendToUser.mock.calls[0][2].body).toContain('Amount does not match');
  });

  it('looks the submission up by id AND tenant; another school finds nothing and no push goes out', async () => {
    const { listener, query, sendToUser } = build(undefined);
    await listener.handle('CONFIRMED', event);
    expect(query.mock.calls[0][1]).toEqual(['s1', 't1']);
    expect(sendToUser).not.toHaveBeenCalled();
  });

  it('a push failure never throws', async () => {
    const { listener, sendToUser } = build({
      submitted_by_user_id: 'g1',
      source: 'PROOF',
      reject_reason: null,
    });
    sendToUser.mockRejectedValue(new Error('down'));
    await expect(listener.handle('CONFIRMED', event)).resolves.toBeUndefined();
  });

  it('subscribes to the event bus on init and stops on destroy', async () => {
    const { listener, sendToUser } = build({
      submitted_by_user_id: 'g1',
      source: 'PROOF',
      reject_reason: null,
    });
    listener.onModuleInit();
    paymentSubmissionEvents.emit(PAYMENT_SUBMISSION_EVENTS.CONFIRMED, event);
    await vi.waitFor(() => expect(sendToUser).toHaveBeenCalledTimes(1));
    listener.onModuleDestroy();
    expect(paymentSubmissionEvents.listenerCount(PAYMENT_SUBMISSION_EVENTS.CONFIRMED)).toBe(0);
  });
});
