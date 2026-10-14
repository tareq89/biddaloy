import { randomUUID } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import {
  CommunicationProvider,
  CommunicationSendParams,
  CommunicationSendResult,
} from '../communication-provider.interface';

export const DEMO_LOG_PROVIDER = 'demo-log';

/**
 * [58.1.02] The only provider in `DEMO_MODE` (D2): "sends" every medium by logging, so the
 * demo's `CommunicationLog` fills with realistic SENT rows and nothing leaves the server.
 * Does no network I/O and never reads tenant or env provider config.
 */
@Injectable()
export class DemoLogProvider implements CommunicationProvider {
  private readonly logger = new Logger(DemoLogProvider.name);

  async send(params: CommunicationSendParams): Promise<CommunicationSendResult> {
    this.logger.log(`demo send to ${maskRecipient(params.to)} (${params.body.length} chars)`);
    return {
      success: true,
      providerMessageId: `${DEMO_LOG_PROVIDER}-${randomUUID()}`,
      raw: { provider: DEMO_LOG_PROVIDER },
      outcome: 'ACCEPTED',
    };
  }
}

/** Keeps the last 3 characters: `01711111111` -> `********111`. */
function maskRecipient(to: string): string {
  return to.length <= 3 ? '***' : '*'.repeat(to.length - 3) + to.slice(-3);
}
