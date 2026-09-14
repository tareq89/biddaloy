import { describe, it, expect, vi } from 'vitest';
import { CommunicationMedium } from '@biddaloy/shared';
import { Guardian } from '../students/entities/guardian.entity';
import {
  FeeNotificationsListener,
  resolveFeeNotificationChannel,
} from './fee-notifications.listener';
import { feesEvents } from '../fees/fee-generation.service';

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
 * on `Guardian`. So the tenant-level `whatsappAvailable` flag (mirroring
 * `smsAvailable`, both sourced from `settings.communications`) is what
 * actually gates WhatsApp — without it, a guardian with a phone always
 * resolved to WhatsApp first regardless of whether the tenant even had a
 * WhatsApp provider configured, and the SMS branch was unreachable.
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
  it('picks WhatsApp when the guardian has a phone number and WhatsApp is available', () => {
    const result = resolveFeeNotificationChannel(guardian({ phone: '+8801700000000' }), true, true);
    expect(result).toEqual({ medium: CommunicationMedium.WHATSAPP, address: '+8801700000000' });
  });

  it('picks WhatsApp from the alternate phone when the primary phone is missing', () => {
    const result = resolveFeeNotificationChannel(
      guardian({ phone: null, alternate_phone: '+8801800000000' }),
      true,
      true,
    );
    expect(result).toEqual({ medium: CommunicationMedium.WHATSAPP, address: '+8801800000000' });
  });

  it('falls back to SMS when WhatsApp is unavailable but SMS is', () => {
    const result = resolveFeeNotificationChannel(
      guardian({ phone: '+8801700000000' }),
      true,
      false,
    );
    expect(result).toEqual({ medium: CommunicationMedium.SMS, address: '+8801700000000' });
  });

  it('skips (null) a guardian with a phone when neither WhatsApp nor SMS is available', () => {
    const result = resolveFeeNotificationChannel(
      guardian({ phone: '+8801700000000' }),
      false,
      false,
    );
    expect(result).toBeNull();
  });

  it('skips (null) an email-only guardian when SMS is enabled — no phone means no SMS address either', () => {
    const result = resolveFeeNotificationChannel(
      guardian({ phone: null, email: 'g@example.com' }),
      true,
      true,
    );
    expect(result).toBeNull();
  });

  it('skips (null) an email-only guardian when SMS is disabled', () => {
    const result = resolveFeeNotificationChannel(
      guardian({ phone: null, email: 'g@example.com' }),
      false,
      false,
    );
    expect(result).toBeNull();
  });

  it('skips (null) a guardian with no contact information at all', () => {
    const result = resolveFeeNotificationChannel(guardian({}), true, true);
    expect(result).toBeNull();
  });
});

describe('FeeNotificationsListener.onModuleInit', () => {
  // Regression: `onModuleInit` used to fire-and-forget
  // `handleFeesGenerated` (`void this.handleFeesGenerated(event)`),
  // discarding a rejection as an unhandled promise rejection instead of
  // logging it.
  it('logs and does not throw when handleFeesGenerated rejects', async () => {
    const listener = new FeeNotificationsListener(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
    const error = new Error('boom');
    const handleSpy = vi.spyOn(listener, 'handleFeesGenerated').mockRejectedValue(error);
    const loggerSpy = vi.spyOn((listener as any).logger, 'error').mockImplementation(() => {});

    const unhandled = vi.fn();
    process.once('unhandledRejection', unhandled);

    listener.onModuleInit();
    feesEvents.emit('fees.generated', { tenantId: 't1', feeGenerationId: 'fg1' });

    // Let the rejected promise's .catch() microtask run.
    await new Promise((resolve) => setImmediate(resolve));

    expect(handleSpy).toHaveBeenCalled();
    expect(loggerSpy).toHaveBeenCalledWith('fees.generated handler failed for fg1', error.stack);
    expect(unhandled).not.toHaveBeenCalled();
    process.removeListener('unhandledRejection', unhandled);
  });
});
