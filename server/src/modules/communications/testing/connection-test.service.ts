import { Injectable } from '@nestjs/common';
import { CommunicationMedium } from '@biddaloy/shared';
import {
  ConnectionTestResult,
  TestableCommunicationMedium,
} from '../providers/shared/connection-test.types';
import { isMessageSink } from '../providers/sink/message-sink';
import { CommunicationProviderRegistryService } from '../providers/communication-provider.registry';

/**
 * #8.7.12: verifies a medium's credentials against the real provider without sending a message —
 * each provider's own `testConnection()` picks its cheapest verification call.
 *
 * `override` is the unsaved form values (same shape as a `communications.<medium>` block); omitted
 * fields fall through tenant settings then platform env via `MessagingConfigResolver`, the same
 * chain a real send uses.
 *
 * Never lets a raw provider error escape: every path returns `ConnectionTestResult`'s sanitized
 * `message`, including `ProviderNotConfiguredError` thrown before any call is made.
 */
@Injectable()
export class ConnectionTestService {
  constructor(private readonly registry: CommunicationProviderRegistryService) {}

  async test(
    tenantId: string,
    medium: TestableCommunicationMedium,
    override?: Record<string, unknown>,
  ): Promise<ConnectionTestResult> {
    // Epic 87 (D24): on a sink stack nothing real is configured; fixed text, no tenant data read.
    if (isMessageSink()) {
      return { success: true, message: 'Test site: messages go to the test inbox' };
    }
    try {
      const { provider, config } = await this.registry.resolveFor(
        medium as CommunicationMedium,
        tenantId,
        { override },
      );
      return await provider.testConnection(config);
    } catch (err) {
      // ProviderNotConfiguredError's message is an actionable, secret-free string.
      return {
        success: false,
        message: err instanceof Error ? err.message : 'Connection test failed.',
      };
    }
  }
}
