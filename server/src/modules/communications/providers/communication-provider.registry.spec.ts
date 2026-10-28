import { describe, it, expect, afterEach, vi } from 'vitest';
import { CommunicationProviderRegistryService } from './communication-provider.registry';
import { CommunicationMedium } from '@biddaloy/shared';
import { MailpitSinkProvider } from './sink/mailpit-sink.provider';

describe('CommunicationProviderRegistryService', () => {
  const smsProviderFactory = { send: () => Promise.resolve() } as any;
  const whatsAppCloudProvider = { send: () => Promise.resolve() } as any;
  const smtpEmailProvider = { send: () => Promise.resolve() } as any;
  const messengerProvider = { send: () => Promise.resolve() } as any;

  const build = () =>
    new CommunicationProviderRegistryService(
      smsProviderFactory,
      whatsAppCloudProvider,
      smtpEmailProvider,
      messengerProvider,
    );
  const registry = build();

  afterEach(() => vi.unstubAllEnvs());

  // Epic 87: with the sink on, nothing leaves the server, whatever tenant or env config says.
  it('with MESSAGE_SINK=mailpit, every medium resolves to the sink, not the real providers', () => {
    vi.stubEnv('MESSAGE_SINK', 'mailpit');
    const sink = build();
    for (const medium of [
      CommunicationMedium.SMS,
      CommunicationMedium.WHATSAPP,
      CommunicationMedium.EMAIL,
      CommunicationMedium.MESSENGER,
    ]) {
      expect(sink.resolve(medium)).toBeInstanceOf(MailpitSinkProvider);
    }
    expect(sink.resolve(CommunicationMedium.PHONE_CALL)).toBeUndefined();
  });

  it('with MESSAGE_SINK unset, the real providers are untouched', () => {
    vi.stubEnv('MESSAGE_SINK', '');
    expect(build().resolve(CommunicationMedium.SMS)).toBe(smsProviderFactory);
  });

  it('DEMO_MODE=true alone no longer swaps providers', () => {
    vi.stubEnv('MESSAGE_SINK', '');
    vi.stubEnv('DEMO_MODE', 'true');
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
