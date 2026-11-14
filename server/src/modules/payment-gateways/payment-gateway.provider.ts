export interface GatewayPayment {
  paymentID?: string;
  bkashURL?: string;
  trxID?: string;
  transactionStatus?: string;
  amount?: string;
  currency?: string;
  merchantInvoiceNumber?: string;
  statusCode?: string;
}

/**
 * Credentials for one merchant. Billing passes no creds (operator env); a school passes
 * `environment` and the host comes only from `bkash-hosts.ts` (D14). `tenantId` scopes the token cache (D15).
 */
export interface GatewayCreds {
  environment?: string;
  appKey: string;
  appSecret: string;
  username: string;
  password: string;
  /** The cache key is built inside the client from this, never passed in (D15). */
  tenantId: string;
}

export interface CreatePaymentInput {
  amountPaisa: number | string;
  orderId: string;
  callbackUrl: string;
  payerReference: string;
}

/** `creds` is last and optional so billing keeps calling with operator env creds. */
export interface PaymentGatewayProvider {
  testConnection(creds: GatewayCreds): Promise<void>;
  create(input: CreatePaymentInput, creds?: GatewayCreds): Promise<GatewayPayment>;
  execute(paymentID: string, creds?: GatewayCreds): Promise<GatewayPayment>;
  query(paymentID: string, creds?: GatewayCreds): Promise<GatewayPayment>;
}
