import type { CommunicationMedium } from '../enums';

export type ProviderCapability = 'status' | 'balance';

export interface ProviderConfigField {
  key: string;
  label: { en: string; bn: string };
  /** Only `secret` fields are masked / write-only. */
  kind: 'text' | 'url' | 'secret';
  required: boolean;
  advanced?: boolean;
  /** Decides where a send goes (host, port; every `url` field is one too). An override that sets it never borrows stored credentials. */
  destination?: boolean;
  /** Optional, but whose account it is (senderId): never filled from the platform env once the school owns the medium. */
  owned?: boolean;
  /** Read only when a message goes out (the From address): a connection test to a new destination need not carry it. */
  sendOnly?: boolean;
  /** `port`: a whole number from 1 to 65535 (blank keeps the provider's default). */
  format?: 'port';
}

export interface ProviderDescriptor {
  medium: CommunicationMedium;
  name: string;
  label: { en: string; bn: string };
  capabilities: ProviderCapability[];
  fields: ProviderConfigField[];
  supportsTestMessage: boolean;
}

export type MessagingProvidersResponse = {
  [medium in CommunicationMedium]?: {
    providers: ProviderDescriptor[];
    configured: boolean;
    selected: string | null;
  };
};

/** A `format: 'port'` value: digits only (a string or a number), 1-65535. Used by the settings validator and the email provider's port parser. */
export function isValidPort(v: unknown): boolean {
  if (typeof v !== 'string' && typeof v !== 'number') return false;
  const s = String(v);
  return /^\d{1,5}$/.test(s) && Number(s) >= 1 && Number(s) <= 65535;
}
