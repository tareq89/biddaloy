import { countSmsSegments } from '@biddaloy/shared';
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

/**
 * [15.6.1] `countSmsSegments` (`@biddaloy/shared`) is now the single
 * ASCII-vs-Unicode call — it was previously duplicated here as a bare
 * `/[^\x00-\x7F]/` regex, separate from the client's segment counter.
 * `isUnicodeMessage` stays as a thin wrapper so both gateways keep the
 * same call shape they had before; `countSmsSegments` itself is what
 * decides unicode billing (matches the gateways' actual behaviour — see
 * the shared module's doc comment for why that's a deliberate deviation
 * from 3GPP TS 23.038).
 */
export function isUnicodeMessage(message: string): boolean {
  return countSmsSegments(message).encoding === 'UCS_2';
}
