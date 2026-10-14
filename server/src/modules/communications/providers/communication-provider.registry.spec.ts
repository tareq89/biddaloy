import { describe, it, expect, afterEach, vi } from 'vitest';
import { CommunicationProviderRegistryService } from './communication-provider.registry';
import { CommunicationMedium } from '@biddaloy/shared';

describe('CommunicationProviderRegistryService', () => {
  const smsProviderFactory = { send: () => Promise.resolve() } as any;
  const whatsAppCloudProvider = { send: () => Promise.resolve() } as any;
  const smtpEmailProvider = { send: () => Promise.resolve() } as any;
  const messengerProvider = { send: () => Promise.resolve() } as any;
  const demoLogProvider = { send: () => Promise.resolve() } as any;

  const build = () =>
    new CommunicationProviderRegistryService(
      smsProviderFactory,
      whatsAppCloudProvider,
      smtpEmailProvider,
      messengerProvider,
      demoLogProvider,
    );
  const registry = build();

  afterEach(() => vi.unstubAllEnvs());

  // [58.1.02, D2] Demo: nothing leaves the server, whatever the tenant or env config says.
  it('with DEMO_MODE, every medium resolves to the demo-log provider', () => {
    vi.stubEnv('DEMO_MODE', 'true');
    const demo = build();
    for (const medium of [
      CommunicationMedium.SMS,
      CommunicationMedium.WHATSAPP,
      CommunicationMedium.EMAIL,
      CommunicationMedium.MESSENGER,
    ]) {
      expect(demo.resolve(medium)).toBe(demoLogProvider);
    }
    expect(demo.resolve(CommunicationMedium.PHONE_CALL)).toBeUndefined();
  });

  it('without DEMO_MODE, the real providers are untouched', () => {
    vi.stubEnv('DEMO_MODE', '');
    expect(build().resolve(CommunicationMedium.SMS)).toBe(smsProviderFactory);
  });

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
