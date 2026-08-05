import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CommunicationProvider,
  CommunicationSendParams,
  CommunicationSendResult,
} from '../communication-provider.interface';
import { SmsGateway } from './sms-gateway.interface';
import { GreenwebSmsGateway } from './greenweb-sms.gateway';
import { MimSmsGateway } from './mim-sms.gateway';

const SUPPORTED_GATEWAYS = ['greenweb', 'mimsms'] as const;
type SupportedGateway = (typeof SUPPORTED_GATEWAYS)[number];

/**
 * Factory over swappable Bangladeshi SMS gateways. The active gateway is
 * picked from SMS_PROVIDER at startup, and can be swapped at runtime via
 * setGateway() (e.g. from a future admin endpoint) without a redeploy.
 */
@Injectable()
export class SmsProviderFactory implements CommunicationProvider {
  private readonly gateways: Record<SupportedGateway, SmsGateway>;
  private activeGatewayName: SupportedGateway = 'greenweb';

  constructor(
    config: ConfigService,
    private readonly greenwebSmsGateway: GreenwebSmsGateway,
    private readonly mimSmsGateway: MimSmsGateway,
  ) {
    this.gateways = {
      greenweb: this.greenwebSmsGateway,
      mimsms: this.mimSmsGateway,
    };

    const configured = config.get<string>('SMS_PROVIDER');
    if (configured) {
      this.setGateway(configured);
    }
  }

  setGateway(name: string): void {
    const normalized = name.toLowerCase() as SupportedGateway;
    if (!SUPPORTED_GATEWAYS.includes(normalized)) {
      throw new Error(
        `SMS provider "${name}" is not supported. Available: ${SUPPORTED_GATEWAYS.join(', ')}`,
      );
    }
    this.activeGatewayName = normalized;
  }

  getActiveGatewayName(): SupportedGateway {
    return this.activeGatewayName;
  }

  async send(params: CommunicationSendParams): Promise<CommunicationSendResult> {
    return this.gateways[this.activeGatewayName].sendSms(params.to, params.body);
  }
}
