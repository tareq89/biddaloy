import { Injectable } from '@nestjs/common';
import { PaymentGatewayProvider as GatewayKind } from '@biddaloy/shared';
import { BkashClient } from './bkash/bkash.client';
import type { PaymentGatewayProvider } from './payment-gateway.provider';

/** Gateway kind -> its provider, one line each. */
@Injectable()
export class PaymentGatewayRegistry {
  private readonly providers: Record<GatewayKind, PaymentGatewayProvider>;

  constructor(bkash: BkashClient) {
    this.providers = { [GatewayKind.BKASH]: bkash };
  }

  get(kind: GatewayKind): PaymentGatewayProvider {
    return this.providers[kind];
  }
}
