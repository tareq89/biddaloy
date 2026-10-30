import type { CommunicationMedium } from '../enums';

export type ProviderCapability = 'status' | 'balance';

export interface ProviderConfigField {
  key: string;
  label: { en: string; bn: string };
  /** Only `secret` fields are masked / write-only. */
  kind: 'text' | 'url' | 'secret';
  required: boolean;
  advanced?: boolean;
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
