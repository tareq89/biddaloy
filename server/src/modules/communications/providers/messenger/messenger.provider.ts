import { Injectable } from '@nestjs/common';
import {
  CommunicationProvider,
  CommunicationSendParams,
  CommunicationSendResult,
} from '../communication-provider.interface';

/**
 * Placeholder for future Messenger support.
 *
 * Meta's Messenger Platform can only deliver to a PSID (Page-Scoped ID) of
 * a user who has already messaged the school's Facebook Page (or opted in
 * via a Messenger entry point) — there is no API to resolve a guardian's
 * phone number or email into a Messenger recipient. A real implementation
 * needs a PSID-capture flow elsewhere in the product before this provider
 * can do anything with `recipient_address`, so it stays a stub.
 *
 * Returns a failure result rather than throwing, per the
 * CommunicationProvider contract — a thrown error here would leave the
 * CommunicationLog row stuck QUEUED instead of being recorded FAILED.
 */
@Injectable()
export class MessengerProvider implements CommunicationProvider {
  async send(_params: CommunicationSendParams): Promise<CommunicationSendResult> {
    return {
      success: false,
      providerMessageId: null,
      error: 'Messenger sending is not yet implemented',
    };
  }
}
