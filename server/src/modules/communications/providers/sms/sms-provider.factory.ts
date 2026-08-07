import { Injectable } from '@nestjs/common';
import {
  CommunicationProvider,
  CommunicationSendParams,
  CommunicationSendResult,
} from '../communication-provider.interface';
import { GreenwebSmsGateway } from './greenweb-sms.gateway';
import { MimSmsGateway } from './mim-sms.gateway';
import { TenantProviderConfigResolver } from '../../config/tenant-provider-config.resolver';

/**
 * Factory over swappable Bangladeshi SMS gateways. Which gateway a tenant
 * uses, and its credentials, are resolved fresh per send via
 * `TenantProviderConfigResolver.resolveSms(tenantId)` (#8.7.10) — there is
 * no process-wide "active gateway" anymore, since that would mean every
 * tenant shares one gateway selection.
 */
@Injectable()
export class SmsProviderFactory implements CommunicationProvider {
  constructor(
    private readonly configResolver: TenantProviderConfigResolver,
    private readonly greenwebSmsGateway: GreenwebSmsGateway,
    private readonly mimSmsGateway: MimSmsGateway,
  ) {}

  async send(params: CommunicationSendParams, tenantId: string): Promise<CommunicationSendResult> {
    try {
      // A ProviderNotConfiguredError from this call is caught by the same
      // catch block as a gateway-level failure below — this provider's
      // contract is "never throw" regardless of which step failed.
      const config = await this.configResolver.resolveSms(tenantId);
      if (config.gateway === 'mimsms') {
        return await this.mimSmsGateway.sendSms(params.to, params.body, config);
      }
      return await this.greenwebSmsGateway.sendSms(params.to, params.body, config);
    } catch (err) {
      return {
        success: false,
        providerMessageId: null,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
