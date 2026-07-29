import { Injectable, NotImplementedException } from '@nestjs/common';
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
 */
@Injectable()
export class MessengerProvider implements CommunicationProvider {
  async send(_params: CommunicationSendParams): Promise<CommunicationSendResult> {
    throw new NotImplementedException('Messenger sending is not yet implemented');
  }
}
