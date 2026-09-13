import { describe, it, expect } from 'vitest';
import { CommunicationMedium } from '@biddaloy/shared';
import { Guardian } from '../students/entities/guardian.entity';
import { resolveFeeNotificationChannel } from './fee-notifications.listener';

/**
 * Unit coverage for the push -> WhatsApp -> SMS fallback matrix (D13).
 *
 * Push itself is out of scope here — `CommunicationsProcessor.tryPushFirst`
 * (`worker/communications.processor.ts`) decides that at send time for
 * every `CommunicationTrigger.AUTOMATED` log — so "push ok" / "push
 * unavailable" are not branches this function takes; it only answers what
 * medium the log should fall back to if push doesn't deliver.
 *
 * Note on reachability: `addressForMedium` (`reminder-recipients.util.ts`)
 * resolves both WHATSAPP and SMS to the same `phone`/`alternate_phone`
 * field — there is no separate "is this number WhatsApp-registered" flag
 * on `Guardian`. So in practice the SMS branch below only fires for a
 * guardian with no phone number at all (email-only), which also means it
 * has no SMS address either — same conclusion the "no phone" test reaches.
 * A guardian who *does* have a phone always resolves to WhatsApp first,
 * per D13's stated order. Flagged for product/ticket follow-up: reaching a
 * guardian's phone by SMS specifically (not WhatsApp) would need either a
 * WhatsApp-capability flag on `Guardian` or a worker-level "retry on the
 * next medium after a provider failure" — neither exists today.
 */

function guardian(overrides: Partial<Guardian>): Guardian {
  return {
    id: 'g1',
    full_name: 'Karim Uddin',
    phone: null,
    alternate_phone: null,
    email: null,
    ...overrides,
  } as Guardian;
}

describe('resolveFeeNotificationChannel', () => {
  it('picks WhatsApp when the guardian has a phone number', () => {
    const result = resolveFeeNotificationChannel(guardian({ phone: '+8801700000000' }), true);
    expect(result).toEqual({ medium: CommunicationMedium.WHATSAPP, address: '+8801700000000' });
  });

  it('picks WhatsApp from the alternate phone when the primary phone is missing', () => {
    const result = resolveFeeNotificationChannel(
      guardian({ phone: null, alternate_phone: '+8801800000000' }),
      true,
    );
    expect(result).toEqual({ medium: CommunicationMedium.WHATSAPP, address: '+8801800000000' });
  });

  it('picks WhatsApp over SMS even when SMS is disabled — a phone always resolves to WhatsApp first', () => {
    const result = resolveFeeNotificationChannel(guardian({ phone: '+8801700000000' }), false);
    expect(result?.medium).toBe(CommunicationMedium.WHATSAPP);
  });

  it('skips (null) an email-only guardian when SMS is enabled — no phone means no SMS address either', () => {
    const result = resolveFeeNotificationChannel(guardian({ phone: null, email: 'g@example.com' }), true);
    expect(result).toBeNull();
  });

  it('skips (null) an email-only guardian when SMS is disabled', () => {
    const result = resolveFeeNotificationChannel(guardian({ phone: null, email: 'g@example.com' }), false);
    expect(result).toBeNull();
  });

  it('skips (null) a guardian with no contact information at all', () => {
    const result = resolveFeeNotificationChannel(guardian({}), true);
    expect(result).toBeNull();
  });
});
