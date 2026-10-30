import { NotImplementedException } from '@nestjs/common';
import type { ProviderDescriptor } from '@biddaloy/shared';
import {
  CommunicationSendParams,
  CommunicationSendResult,
} from './communication-provider.interface';
import { ConnectionTestResult } from './shared/connection-test.types';
import { OutboundDestinationError } from './shared/outbound-destination-guard';
import { normalizeBdPhoneNumber } from './shared/phone-number.util';

/** A provider answered and refused the credentials (bad key), as opposed to not being reachable. */
export class ProviderAuthRejectedError extends Error {
  constructor() {
    super('The provider rejected the credentials.');
    this.name = 'ProviderAuthRejectedError';
  }
}

/** D24: one base class for every vendor. No constructor, no injected deps: HealthModule builds the SMS ones bare. */
export abstract class MessagingProvider<TConfig = Record<string, string>> {
  abstract readonly descriptor: ProviderDescriptor;
  abstract readonly envPrefix: string;
  abstract send(params: CommunicationSendParams, config: TConfig): Promise<CommunicationSendResult>;
  // Optional METHOD signatures, never properties: with ES2022 define semantics a base-class
  // property would be emitted as an own `undefined` field and shadow a subclass's prototype method.
  /** Capability `status`. */
  getStatus?(
    providerMessageId: string,
    config: TConfig,
  ): Promise<{ status: 'DELIVERED' | 'FAILED' | 'PENDING'; code?: string }>;
  /** Capability `balance`. */
  getBalance?(config: TConfig): Promise<{ amount: number; estimateSms?: number }>;

  /** Default: a balance check. A provider without the `balance` capability must override this. */
  async testConnection(config: TConfig): Promise<ConnectionTestResult> {
    if (!this.descriptor.capabilities.includes('balance') || !this.getBalance) {
      throw new NotImplementedException(
        `${this.descriptor.name}: override testConnection or declare the balance capability`,
      );
    }
    try {
      await this.getBalance(config);
      // No amount: with no school block the config may be the platform's own account (Rule 23).
      return { success: true, message: `Connected to ${this.descriptor.label.en}.` };
    } catch (err) {
      if (err instanceof OutboundDestinationError) {
        return { success: false, message: err.publicMessage };
      }
      if (err instanceof ProviderAuthRejectedError) {
        return {
          success: false,
          message: `${this.descriptor.label.en} rejected the API key — check it and try again.`,
        };
      }
      return { success: false, message: `Could not reach ${this.descriptor.label.en}.` };
    }
  }

  protected normalizeBdPhone(to: string): string {
    return normalizeBdPhoneNumber(to);
  }
}
