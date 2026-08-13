import { CommunicationMedium } from '@biddaloy/shared';

/**
 * Result of a provider's cheapest-verification-call connection test
 * (#8.7.12). `message` is always an actionable, human-readable string —
 * "authentication rejected", "phone number id not found" — never the raw
 * provider response body, which could echo the credential being tested
 * back in an error payload.
 */
export interface ConnectionTestResult {
  success: boolean;
  message: string;
}

/** The 4 media with a real provider — `PHONE_CALL` has none registered in
 * `CommunicationProviderRegistryService` and so has no connection test. */
export const TESTABLE_MEDIA = [
  CommunicationMedium.SMS,
  CommunicationMedium.WHATSAPP,
  CommunicationMedium.EMAIL,
  CommunicationMedium.MESSENGER,
] as const;

export type TestableCommunicationMedium = (typeof TESTABLE_MEDIA)[number];
