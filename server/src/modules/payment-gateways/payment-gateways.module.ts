import { Module } from '@nestjs/common';
import { AccountAccessModule } from '../account-access/account-access.module';
import { BkashClient } from './bkash/bkash.client';
import { PaymentGatewayRegistry } from './payment-gateway.registry';

@Module({
  imports: [AccountAccessModule], // OTP_REDIS: the gateway token cache
  providers: [BkashClient, PaymentGatewayRegistry],
  exports: [BkashClient, PaymentGatewayRegistry],
})
export class PaymentGatewaysModule {}
