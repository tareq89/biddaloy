import { PaymentGatewayEnvironment } from '@biddaloy/shared';

/** D14: a tenant never supplies a URL; its environment picks one of these fixed hosts. */
export const BKASH_HOSTS: Record<PaymentGatewayEnvironment, string> = {
  [PaymentGatewayEnvironment.SANDBOX]: 'https://tokenized.sandbox.bka.sh/v1.2.0-beta',
  [PaymentGatewayEnvironment.PRODUCTION]: 'https://tokenized.pay.bka.sh/v1.2.0-beta',
};
