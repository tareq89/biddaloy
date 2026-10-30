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
