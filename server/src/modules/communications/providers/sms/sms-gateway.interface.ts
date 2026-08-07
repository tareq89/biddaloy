import { CommunicationSendResult } from '../communication-provider.interface';
import { ConnectionTestResult } from '../shared/connection-test.types';

/**
 * `TConfig` is each gateway's own resolved-config shape
 * (`ResolvedGreenwebSmsConfig`/`ResolvedMimSmsConfig` from
 * `TenantProviderConfigResolver`) — `SmsProviderFactory` resolves the
 * tenant's chosen gateway's config once per send and passes it straight
 * through, rather than each gateway reaching for `ConfigService` itself
 * (#8.7.10).
 */
export interface SmsGateway<TConfig> {
  sendSms(to: string, message: string, config: TConfig): Promise<CommunicationSendResult>;
  /** #8.7.12's connection test — the gateway's cheapest verification call, never a real SMS send. */
  testConnection(config: TConfig): Promise<ConnectionTestResult>;
}

/** SMS gateway text is non-ASCII (Bangla) -> gateways bill/segment it as unicode SMS. */
export function isUnicodeMessage(message: string): boolean {
  return /[^\x00-\x7F]/.test(message);
}
