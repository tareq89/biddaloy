import { describe, it, expect } from 'vitest';
import { CommunicationProviderRegistryService } from './communication-provider.registry';
import { CommunicationMedium } from '@biddaloy/shared';

describe('CommunicationProviderRegistryService', () => {
  const smsProviderFactory = { send: () => Promise.resolve() } as any;
  const whatsAppCloudProvider = { send: () => Promise.resolve() } as any;
  const smtpEmailProvider = { send: () => Promise.resolve() } as any;
  const messengerProvider = { send: () => Promise.resolve() } as any;

  const registry = new CommunicationProviderRegistryService(
    smsProviderFactory,
    whatsAppCloudProvider,
    smtpEmailProvider,
    messengerProvider,
  );

  it('resolves SMS to the SMS provider factory', () => {
    expect(registry.resolve(CommunicationMedium.SMS)).toBe(smsProviderFactory);
  });

  it('resolves WHATSAPP to the WhatsApp Cloud provider', () => {
    expect(registry.resolve(CommunicationMedium.WHATSAPP)).toBe(whatsAppCloudProvider);
  });

  it('resolves EMAIL to the SMTP provider', () => {
    expect(registry.resolve(CommunicationMedium.EMAIL)).toBe(smtpEmailProvider);
  });

  it('resolves MESSENGER to the Messenger stub provider', () => {
    expect(registry.resolve(CommunicationMedium.MESSENGER)).toBe(messengerProvider);
  });

  it('returns undefined for a medium with no registered provider', () => {
    expect(registry.resolve(CommunicationMedium.PHONE_CALL)).toBeUndefined();
  });
});
