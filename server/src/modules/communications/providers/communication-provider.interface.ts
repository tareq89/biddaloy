import { CommunicationMedium } from '@biddaloy/shared';

export interface CommunicationSendParams {
  to: string;
  body: string;
  /** Email only. */
  subject?: string;
  /** WhatsApp only — sending a pre-approved template instead of freeform text. */
  templateName?: string;
  templateLanguage?: string;
  templateParams?: string[];
}

export interface CommunicationSendResult {
  success: boolean;
  providerMessageId: string | null;
  error?: string;
  raw?: Record<string, any>;
}

/**
 * Uniform contract every channel provider implements, so
 * CommunicationsProcessor can dispatch by CommunicationMedium without
 * knowing which concrete gateway/API is behind it. A provider must never
 * throw — network/API failures are caught internally and returned as
 * `{ success: false, error }` so the processor always gets a result to
 * persist onto the CommunicationLog row.
 */
export interface CommunicationProvider {
  send(params: CommunicationSendParams): Promise<CommunicationSendResult>;
}

export const COMMUNICATION_PROVIDER_REGISTRY = 'COMMUNICATION_PROVIDER_REGISTRY';

// Partial: not every CommunicationMedium (e.g. PHONE_CALL) has an
// automated provider — CommunicationsProcessor treats a missing entry as
// an unsupported medium and fails the job rather than assuming coverage.
export type CommunicationProviderRegistry = Partial<
  Record<CommunicationMedium, CommunicationProvider>
>;
